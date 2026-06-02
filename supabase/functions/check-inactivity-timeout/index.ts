import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getSupportConfig } from "../_shared/support-config.ts";
import { sendAndPersistAutoMessage } from "../_shared/message-processor.ts";
import { getInstanceSecrets } from "../_shared/providers/index.ts";
import { SendContext } from "../_shared/message-types.ts";
import { isWithinBusinessHours } from "../_shared/business-hours.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOG = "[check-inactivity-timeout]";

// ─── Limites de execução ────────────────────────────────────────────────────
// PAGE_SIZE: tamanho de cada lote lido do banco (keyset por id).
// MAX_SENDS_PER_RUN: teto de MENSAGENS (aviso + encerramento) disparadas por
//   execução. Protege os tenants de uma rajada quando há backlog acumulado:
//   a AVALIAÇÃO roda em todos os vencidos, mas só MAX_SENDS_PER_RUN disparam
//   por ciclo; o restante é pego nos ciclos seguintes (cron a cada 2 min).
// TIME_BUDGET_MS: para o loop com folga antes do timeout de 30s do cron,
//   garantindo que nunca seja cortado no meio de um lote.
// MAX_PAGES: trava dura anti-loop-infinito (PAGE_SIZE * MAX_PAGES avaliações/ciclo).
const PAGE_SIZE = 50;
const MAX_SENDS_PER_RUN = 20;
const TIME_BUDGET_MS = 22000;
const MAX_PAGES = 20;

interface AttendanceRow {
  id: string;
  attendance_code: string;
  tenant_id: string;
  conversation_id: string;
  contact_id: string;
  assigned_to: string | null;
  opened_at: string;
  last_customer_message_at: string | null;
  last_operator_message_at: string | null;
  inactivity_warning_sent_at: string | null;
  scheduled_until: string | null;
}

interface ContactRow {
  id: string;
  phone_number: string;
  name: string | null;
}

// Resultado de processAttendance. "*_skipped_limit" = decisão dizia enviar,
// mas o teto de envios do ciclo já estourou → fica pro próximo ciclo.
type ProcessResult =
  | "closed"
  | "warned"
  | "skipped"
  | "warn_skipped_limit"
  | "close_skipped_limit"
  | "error";

function getLastActivityIso(att: AttendanceRow): string {
  const candidates = [
    att.last_customer_message_at,
    att.last_operator_message_at,
    att.opened_at,
  ].filter((x): x is string => !!x);
  if (candidates.length === 0) return att.opened_at;
  return candidates.reduce((max, cur) => (cur > max ? cur : max));
}

async function buildSendContext(
  supabase: any,
  tenantId: string,
  conversationId: string
): Promise<{ ctx: SendContext; contact: ContactRow } | null> {
  const { data: conv } = await supabase
    .from("whatsapp_conversations")
    .select("id, instance_id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;

  const { data: contact } = await supabase
    .from("whatsapp_contacts")
    .select("id, phone_number, name")
    .eq("id", conv.contact_id)
    .maybeSingle();
  if (!contact) return null;

  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("id, instance_name, instance_id_external, provider_type, meta_phone_number_id, skip_ura, tenant_id")
    .eq("id", conv.instance_id)
    .maybeSingle();
  if (!instance) return null;

  const secrets = await getInstanceSecrets(supabase, instance.id);
  if (!secrets) return null;

  const phone = contact.phone_number;
  const remoteJid = phone.includes("@") ? phone : `${phone}@s.whatsapp.net`;

  const ctx: SendContext = {
    instanceId: instance.id,
    tenantId,
    providerType: instance.provider_type as any,
    instanceInfo: {
      id: instance.id,
      instance_name: instance.instance_name,
      provider_type: instance.provider_type as any,
      instance_id_external: instance.instance_id_external,
      meta_phone_number_id: instance.meta_phone_number_id,
      skip_ura: instance.skip_ura ?? false,
      tenant_id: tenantId,
    },
    secrets: secrets as any,
    remoteJid,
    contactName: contact.name || phone,
  };

  return { ctx, contact };
}

// canSend(): retorna true se ainda há orçamento de envio no ciclo.
// Recebe um objeto-contador por referência para que o incremento seja visível
// ao chamador (o loop principal), garantindo o teto global por execução.
async function processAttendance(
  supabase: any,
  att: AttendanceRow,
  correlationId: string,
  budget: { sends: number }
): Promise<ProcessResult> {
  const log = (msg: string, extra?: any) =>
    console.log(`${LOG}[${correlationId}][${att.attendance_code}] ${msg}`, extra ?? "");

  try {
    // Guard: atendimento aguardando avaliação CSAT — não encerrar por inatividade.
    // O ciclo de vida pós-CSAT (captura da nota e encerramento) é gerido pelo check-csat-timeout.
    {
      const { data: pendingCsat } = await supabase
        .from("support_csat")
        .select("id")
        .eq("attendance_id", att.id)
        .in("status", ["pending", "awaiting_reason"])
        .limit(1)
        .maybeSingle();
      if (pendingCsat) {
        log("CSAT pendente — skip inactivity close (csat-timeout cuida)");
        return "skipped";
      }
    }

    const config = await getSupportConfig(supabase, att.tenant_id);

    // Guard "Sem regras do sistema": contato com rules_disabled=true → pula tudo.
    {
      const { data: contactRules } = await supabase
        .from("whatsapp_contacts")
        .select("rules_disabled")
        .eq("id", att.contact_id)
        .maybeSingle();
      if (contactRules?.rules_disabled === true) {
        log("rules_disabled=true no contato — skip");
        return "skipped";
      }
    }

    // Guard: estamos dentro do horário comercial AGORA?
    // Sempre checar — não depende mais da flag opened_out_of_hours.
    // Fail-safe: se a checagem falhar, assume "fora" e pula (não pune cliente).
    {
      const { data: convOOH } = await supabase
        .from("whatsapp_conversations")
        .select("opened_out_of_hours, instance_id")
        .eq("id", att.conversation_id)
        .maybeSingle();

      if (config.business_hours_enabled && convOOH?.instance_id) {
        let insideNow = false;
        try {
          insideNow = await isWithinBusinessHours(
            supabase,
            att.conversation_id,
            convOOH.instance_id,
            att.tenant_id,
            config,
          );
        } catch (err) {
          console.error(
            `${LOG}[${correlationId}][${att.attendance_code}] isWithinBusinessHours falhou — fail-safe: skip`,
            err,
          );
          return "skipped";
        }

        if (!insideNow) {
          log("fora do horário comercial agora — skip");
          return "skipped";
        }

        // Dentro do horário: limpa flag obsoleta se ainda estiver setada
        if (convOOH?.opened_out_of_hours === true) {
          await supabase
            .from("whatsapp_conversations")
            .update({
              opened_out_of_hours: false,
              out_of_hours_cleared_at: new Date().toISOString(),
            })
            .eq("id", att.conversation_id);
        }
      }
    }

    // Overrides de inatividade: fechamento E aviso seguem setor > instância > global.
    let deptOverride: number | null = null;
    let instOverride: number | null = null;
    let deptWarnOverride: number | null = null;
    let instWarnOverride: number | null = null;
    {
      const { data: convOverrides } = await supabase
        .from("whatsapp_conversations")
        .select("department_id, instance_id, support_departments!left(auto_close_inactivity_minutes, inactivity_warning_before_minutes), whatsapp_instances!left(auto_close_inactivity_minutes, inactivity_warning_before_minutes)")
        .eq("id", att.conversation_id)
        .maybeSingle();

      if (convOverrides) {
        deptOverride = (convOverrides as any).support_departments?.auto_close_inactivity_minutes ?? null;
        instOverride = (convOverrides as any).whatsapp_instances?.auto_close_inactivity_minutes ?? null;
        deptWarnOverride = (convOverrides as any).support_departments?.inactivity_warning_before_minutes ?? null;
        instWarnOverride = (convOverrides as any).whatsapp_instances?.inactivity_warning_before_minutes ?? null;
      }
    }

    const closeThresholdMin = deptOverride ?? instOverride ?? config.support_auto_close_inactivity_minutes;
    const warnEnabled = config.support_send_inactivity_warning === true;
    const warnGlobal = config.support_inactivity_warning_before_minutes;
    const warnTemplate = config.support_inactivity_warning_template ||
      "⚠️ Por falta de interação, este atendimento será encerrado em {{minutes}} minutos. Se ainda precisar de ajuda, responda esta mensagem.";

    if (!closeThresholdMin || closeThresholdMin <= 0) {
      log("close threshold inválido — skip", { closeThresholdMin });
      return "skipped";
    }

    const resolvedWarnBefore = deptWarnOverride ?? instWarnOverride ?? warnGlobal;
    const warnBeforeMin = Math.min(resolvedWarnBefore, closeThresholdMin);

    const lastActivityIso = getLastActivityIso(att);
    const elapsedMin = (Date.now() - new Date(lastActivityIso).getTime()) / 60000;

    // ─── FLUXO COM AVISO ATIVADO ──────────────────────────────────────────────
    if (warnEnabled) {
      if (warnBeforeMin <= 0) {
        log("warnBefore inválido com aviso ativado — skip", { warnBeforeMin });
        return "skipped";
      }

      // Caso A: aviso ainda não enviado
      if (!att.inactivity_warning_sent_at) {
        const warnAtMin = Math.max(0, closeThresholdMin - warnBeforeMin);
        if (elapsedMin < warnAtMin) return "skipped"; // ainda não chegou a hora

        // Vai ENVIAR aviso → respeita o teto de envios do ciclo
        if (budget.sends >= MAX_SENDS_PER_RUN) {
          log("teto de envios atingido — adiando aviso pro próximo ciclo");
          return "warn_skipped_limit";
        }

        const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);
        if (!built) {
          log("não foi possível construir SendContext — skip");
          return "skipped";
        }

        const message = warnTemplate.replace(/\{\{minutes\}\}/g, String(warnBeforeMin));
        await sendAndPersistAutoMessage(
          supabase, built.ctx, att.conversation_id, message,
          { system: true, inactivity_warning: true, attendance_id: att.id }
        );
        budget.sends++; // contabiliza o envio

        await supabase
          .from("support_attendances")
          .update({ inactivity_warning_sent_at: new Date().toISOString() })
          .eq("id", att.id)
          .is("inactivity_warning_sent_at", null);

        log("aviso enviado", { elapsedMin, warnAtMin, sendsNoCiclo: budget.sends });
        return "warned";
      }

      // Caso B: aviso já enviado — só fecha após warnBeforeMin desde o aviso
      const warningSentAt = new Date(att.inactivity_warning_sent_at).getTime();
      const minSinceWarning = (Date.now() - warningSentAt) / 60000;
      if (minSinceWarning < warnBeforeMin) return "skipped";

      // Vai ENVIAR encerramento → respeita o teto
      if (budget.sends >= MAX_SENDS_PER_RUN) {
        log("teto de envios atingido — adiando encerramento pro próximo ciclo");
        return "close_skipped_limit";
      }

      log("janela pós-aviso expirada — encerrando", { minSinceWarning, warnBeforeMin });
      const r = await closeAttendance(supabase, att, correlationId);
      if (r === "closed") budget.sends++;
      return r;
    }

    // ─── FLUXO COM AVISO DESATIVADO ───────────────────────────────────────────
    if (elapsedMin >= closeThresholdMin) {
      if (budget.sends >= MAX_SENDS_PER_RUN) {
        log("teto de envios atingido — adiando encerramento (sem aviso) pro próximo ciclo");
        return "close_skipped_limit";
      }
      log("aviso desativado, threshold atingido — encerrando", { elapsedMin, closeThresholdMin });
      const r = await closeAttendance(supabase, att, correlationId);
      if (r === "closed") budget.sends++;
      return r;
    }

    return "skipped";
  } catch (err) {
    console.error(`${LOG}[${correlationId}][${att.attendance_code}] erro:`, err);
    return "error";
  }
}

async function closeAttendance(
  supabase: any,
  att: AttendanceRow,
  correlationId: string
): Promise<"closed" | "skipped"> {
  const log = (msg: string, extra?: any) =>
    console.log(`${LOG}[${correlationId}][${att.attendance_code}] ${msg}`, extra ?? "");

  const built = await buildSendContext(supabase, att.tenant_id, att.conversation_id);

  const { data: result, error: rpcErr } = await supabase
    .rpc("fn_close_attendance_atomic", {
      p_attendance_id: att.id,
      p_closed_reason: "inactivity",
      p_closure_type: "inactivity_auto",
    });

  if (rpcErr) {
    log("erro na RPC fn_close_attendance_atomic", rpcErr);
    return "skipped";
  }
  if (!result?.success) {
    log("RPC retornou falha", result);
    return "skipped";
  }

  if (built) {
    await sendAndPersistAutoMessage(
      supabase, built.ctx, att.conversation_id,
      `\u{2705} Atendimento *${att.attendance_code}* encerrado por inatividade.\n\nSe precisar de algo, \u00e9 s\u00f3 nos enviar uma nova mensagem. \u{1F60A}`,
      { system: true, attendance_event: "closed", attendance_id: att.id, inactivity_close: true }
    );
  }

  return "closed";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const correlationId = crypto.randomUUID().slice(0, 8);
  const startedAt = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const nowIso = new Date().toISOString();
    const budget = { sends: 0 };
    const summary: Record<ProcessResult, number> = {
      closed: 0, warned: 0, skipped: 0,
      warn_skipped_limit: 0, close_skipped_limit: 0, error: 0,
    };

    // Loop paginado por keyset (id ascending). Avalia TODOS os in_progress
    // vencidos, em lotes, parando por: orçamento de tempo, teto de páginas,
    // ou fim da fila. O teto de ENVIOS é aplicado dentro de processAttendance.
    let cursorId: string | null = null;
    let pages = 0;
    let scanned = 0;
    let stopReason = "fim_da_fila";

    while (pages < MAX_PAGES) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stopReason = "orcamento_tempo"; break; }

      let q = supabase
        .from("support_attendances")
        .select("id, attendance_code, tenant_id, conversation_id, contact_id, assigned_to, opened_at, last_customer_message_at, last_operator_message_at, inactivity_warning_sent_at, scheduled_until")
        .eq("status", "in_progress")
        .or(`scheduled_until.is.null,scheduled_until.lte.${nowIso}`)
        .order("id", { ascending: true })
        .limit(PAGE_SIZE);

      if (cursorId) q = q.gt("id", cursorId);

      const { data: rows, error } = await q;
      if (error) throw error;

      const attendances = (rows ?? []) as AttendanceRow[];
      if (attendances.length === 0) { stopReason = "fim_da_fila"; break; }

      pages++;
      scanned += attendances.length;
      cursorId = attendances[attendances.length - 1].id;

      // Processa o lote SEQUENCIALMENTE (não em paralelo). É deliberado: o teto
      // de envios (budget.sends) precisa ser checado e incrementado de forma serial,
      // senão N atendimentos leriam budget.sends=0 ao mesmo tempo e disparariam todos
      // antes do contador subir — exatamente a rajada que queremos evitar. A maioria
      // dos atendimentos retorna "skipped" rápido (sem I/O de envio), então o custo
      // sequencial é baixo; e a guarda de tempo (TIME_BUDGET_MS) protege o ciclo.
      for (const att of attendances) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) { stopReason = "orcamento_tempo"; break; }
        let res: ProcessResult;
        try {
          res = await processAttendance(supabase, att, correlationId, budget);
        } catch {
          res = "error";
        }
        summary[res] = (summary[res] || 0) + 1;
        if (budget.sends >= MAX_SENDS_PER_RUN) break; // teto atingido no meio do lote
      }

      // Se já atingiu o teto de envios, não adianta varrer mais páginas neste ciclo:
      // tudo que enviaria viraria *_skipped_limit. Para e deixa pro próximo ciclo.
      if (budget.sends >= MAX_SENDS_PER_RUN) { stopReason = "teto_envios"; break; }

      // Lote menor que PAGE_SIZE = última página.
      if (attendances.length < PAGE_SIZE) { stopReason = "fim_da_fila"; break; }
    }

    const elapsed = Date.now() - startedAt;
    console.log(`${LOG}[${correlationId}] done`, {
      scanned, pages, sends: budget.sends, stopReason, elapsed_ms: elapsed, ...summary,
    });

    return new Response(
      JSON.stringify({ success: true, scanned, pages, sends: budget.sends, stopReason, ...summary, elapsed_ms: elapsed }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`${LOG}[${correlationId}] fatal:`, err);
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : "unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
