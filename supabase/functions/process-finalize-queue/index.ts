import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const FUNCTION_NAME = "process-finalize-queue";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH = 10;
const MAX_BATCH = 50;
const MAX_ATTEMPTS = 3;
// Espera antes da 2a e da 3a tentativa quando o defeito e do PROPRIO item
// (dado ruim, bug). Antes eram 3 tentativas coladas, a cada 2 min do cron.
const ESPERA_ITEM_MIN = [5, 30];
// Falha do provedor de IA nao e defeito do item: reagenda sem gastar tentativa.
// Sem credito / chave recusada so voltam quando o cliente age — espera longa.
const ESPERA_PROVEDOR_MIN: Record<string, number> = {
  ai_quota_exceeded: 30,
  ai_key_invalid: 30,
  ai_rate_limited: 5,
  ai_provider_unavailable: 5,
};
// Por quanto tempo a fila segura um atendimento esperando o provedor voltar.
// Passou disso, desiste — e o check-ai-usage-alert avisa a perda.
const PRAZO_PROVEDOR_DIAS = 7;

const minutosDepois = (min: number) => new Date(Date.now() + min * 60 * 1000).toISOString();

serve(async (req) => {
  const requestId = crypto.randomUUID().slice(0, 8);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Sem auth de entrada: a proteção real está na fila (RLS: só trigger/service_role inserem)
  // e no finalize-attendance (que exige service_role). Este processador só drena itens legítimos.
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // limit opcional via body
  let limit = DEFAULT_BATCH;
  try {
    const body = await req.json();
    if (body?.limit) limit = Math.min(MAX_BATCH, Math.max(1, Number(body.limit)));
  } catch { /* sem body, usa default */ }

  // Itens pendentes (ou em erro com retry disponível) cuja hora de tentar já venceu.
  // Item pending sempre tem attempts=0, então o lt(attempts) não o exclui.
  const agoraIso = new Date().toISOString();
  const { data: items, error: selErr } = await supabase
    .from("attendance_analysis_queue")
    .select("attendance_id, tenant_id, attempts, enqueued_at")
    .in("status", ["pending", "error"])
    .lt("attempts", MAX_ATTEMPTS)
    .or(`next_attempt_at.is.null,next_attempt_at.lte."${agoraIso}"`)
    .order("enqueued_at", { ascending: true })
    .limit(limit);

  if (selErr) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Erro lendo fila:`, selErr.message);
    return new Response(
      JSON.stringify({ error: selErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!items || items.length === 0) {
    return new Response(
      JSON.stringify({ success: true, processed: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let done = 0;
  let errors = 0;
  let waiting = 0;
  // Tenant cujo provedor falhou nesta rodada: os outros itens dele já foram
  // reagendados em bloco, não adianta chamar a IA de novo para cada um.
  const pausados = new Set<string>();

  for (const item of items) {
    if (pausados.has(item.tenant_id)) continue;
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/finalize-attendance`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ attendanceId: item.attendance_id }),
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`finalize HTTP ${res.status}: ${txt.substring(0, 200)}`);
      }

      await supabase
        .from("attendance_analysis_queue")
        .update({ status: "done", processed_at: new Date().toISOString(), last_error: null, next_attempt_at: null })
        .eq("attendance_id", item.attendance_id);
      done++;
    } catch (e) {
      const lastError = String(e instanceof Error ? e.message : e).substring(0, 500);
      // finalize-attendance devolve 503 + reason quando o PROVEDOR de IA falhou.
      const motivoProvedor = lastError.match(/^finalize HTTP 503: .*"reason"\s*:\s*"([^"]+)"/)?.[1];
      const esperaProvedor = motivoProvedor ? ESPERA_PROVEDOR_MIN[motivoProvedor] : undefined;

      if (esperaProvedor !== undefined) {
        const idadeDias = (Date.now() - new Date(item.enqueued_at).getTime()) / 86_400_000;
        if (idadeDias < PRAZO_PROVEDOR_DIAS) {
          const proxima = minutosDepois(esperaProvedor);
          await supabase
            .from("attendance_analysis_queue")
            .update({ status: "error", last_error: lastError, next_attempt_at: proxima })
            .eq("attendance_id", item.attendance_id);
          // Reagenda o resto do tenant de uma vez. Sem isso, um tenant sem crédito
          // com dezenas de itens ocupa a cabeça da fila (ordem por enqueued_at) e
          // os outros tenants esperam atrás dele.
          await supabase
            .from("attendance_analysis_queue")
            .update({ next_attempt_at: proxima })
            .eq("tenant_id", item.tenant_id)
            .in("status", ["pending", "error"])
            .lt("attempts", MAX_ATTEMPTS)
            .or(`next_attempt_at.is.null,next_attempt_at.lt."${proxima}"`);
          pausados.add(item.tenant_id);
          console.warn(`[${FUNCTION_NAME}][${requestId}] provedor indisponível (${motivoProvedor}) tenant=${item.tenant_id} — reagendado para ${proxima}`);
          waiting++;
          continue;
        }
      }

      // Erro do próprio item — ou provedor fora há mais de PRAZO_PROVEDOR_DIAS.
      const attempts = esperaProvedor !== undefined ? MAX_ATTEMPTS : (item.attempts ?? 0) + 1;
      const desistiu = attempts >= MAX_ATTEMPTS;
      await supabase
        .from("attendance_analysis_queue")
        .update({
          status: "error",
          attempts,
          last_error: lastError,
          // Só carimba na desistência definitiva. É o único registro de QUANDO a
          // análise foi perdida — é dele que o check-ai-usage-alert sai para avisar
          // (ele filtra attempts >= 3, por isso a desistência por prazo grava MAX).
          // Nas tentativas intermediárias fica nulo: o item ainda volta pra fila.
          ...(desistiu
            ? { processed_at: new Date().toISOString(), next_attempt_at: null }
            : { next_attempt_at: minutosDepois(ESPERA_ITEM_MIN[attempts - 1] ?? 30) }),
        })
        .eq("attendance_id", item.attendance_id);
      if (desistiu) {
        console.error(`[${FUNCTION_NAME}][${requestId}] análise PERDIDA (${attempts} tentativas): attendance=${item.attendance_id}`);
      }
      errors++;
    }
  }

  console.log(`[${FUNCTION_NAME}][${requestId}] processed=${items.length} done=${done} errors=${errors} waiting=${waiting}`);

  return new Response(
    JSON.stringify({ success: true, processed: items.length, done, errors, waiting }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
