// theo-dispatch — Théo (Conselho DS): pulso diário + retrato semanal via WhatsApp
// Determinismo (dados/sinais/fallback) vem do SQL (theo_daily_payload / theo_weekly_payload).
// Esta EF só veste a voz do Théo via LLM e despacha pelo notify_event. LLM falhou => fallback_body.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const MONEY_KEYS = [
  "new_mrr", "upsell_cross", "downsell", "churn_valor", "reactivation",
  "reajuste", "net_new_mrr", "churn_valor_abs",
];
const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);

// Adiciona versão formatada BRL ao lado de cada campo monetário (recursivo).
function withBRL(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const out: any = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") {
      out[k] = withBRL(v);
    } else {
      out[k] = v;
      const num = typeof v === "number" ? v : (typeof v === "string" && v !== "" && !isNaN(Number(v)) ? Number(v) : null);
      if (MONEY_KEYS.includes(k) && num !== null) out[`${k}_brl`] = fmtBRL(num);
    }
  }
  return out;
}

function render(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{{${k}}}`, v ?? "");
  return out;
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}

// Aceita: igualdade com o env OU JWT com claim role=service_role e ASSINATURA válida.
// A assinatura é verificada via probe no PostgREST — imune a verify_jwt=false no gateway
// (deploys automáticos de CI/Lovable podem flipar essa flag; o código não depende dela).
async function isServiceRole(token: string): Promise<boolean> {
  if (!token) return false;
  if (token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload?.role !== "service_role") return false;
  } catch {
    return false;
  }
  // PostgREST rejeita assinatura inválida com 401 — ninguém forja role=service_role sem o JWT secret
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/tenants?select=id&limit=1`, {
    headers: { apikey: token, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });

  const auth = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!(await isServiceRole(auth))) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = await req.json().catch(() => ({}));
  const tipo = body?.tipo;
  if (tipo !== "diario" && tipo !== "semanal") {
    return json({ error: "tipo_invalido", expected: ["diario", "semanal"] }, 400);
  }
  const dryRun = body?.dryRun === true;
  const onlyTenant = body?.tenantId || null;

  const eventKey = tipo === "diario" ? "weekly_management_digest" : "theo_weekly_report";
  const tabKey = tipo === "diario" ? "theo-diario" : "theo-semanal";
  const payloadFn = tipo === "diario" ? "theo_daily_payload" : "theo_weekly_payload";

  const { data: template, error: terr } = await supabase
    .from("conselho_aba_templates").select("*").eq("tab_key", tabKey).eq("ativo", true).maybeSingle();
  if (terr || !template) return json({ error: "template_not_found", tabKey, detail: terr?.message }, 500);

  let q = supabase.from("notification_subscriptions").select("tenant_id")
    .eq("event_type_key", eventKey).eq("ativo", true);
  if (onlyTenant) q = q.eq("tenant_id", onlyTenant);
  const { data: subs, error: serr } = await q;
  if (serr) return json({ error: "subscriptions_error", detail: serr.message }, 500);

  const tenantIds = [...new Set((subs || []).map((s: any) => s.tenant_id))];
  const results: any[] = [];

  for (const tid of tenantIds) {
    const r: any = { tenant_id: tid };
    const startedAt = Date.now();
    try {
      const { data: payload, error: perr } = await supabase.rpc(payloadFn, { p_tenant: tid });
      if (perr || !payload) throw new Error(`payload_error: ${perr?.message || "vazio"}`);

      const [{ data: tenantRow }, { data: cfgRow }, { data: lastMsg }] = await Promise.all([
        supabase.from("tenants").select("nome").eq("id", tid).maybeSingle(),
        supabase.from("theo_config").select("apresentado_em").eq("tenant_id", tid).maybeSingle(),
        supabase.from("conselho_analises").select("output_markdown")
          .eq("tenant_id", tid).eq("tab_key", tabKey).eq("status", "success")
          .order("solicitado_em", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const needsIntro = !cfgRow?.apresentado_em;

      let bodyText: string | null = null;
      let title: string = payload.fallback_title;
      let via = "fallback";
      let cost = 0;

      const aiCfgRaw = await getAIConfig(tid, supabase);
      if (!aiCfgRaw) {
        r.ai_error = "ai_not_configured";
      } else {
        // Persona do Théo vem 100% do template — nunca do system_prompt geral do tenant
        const aiCfg = { ...aiCfgRaw, systemPrompt: null };
        const vars: Record<string, string> = {
          tenant_nome: tenantRow?.nome || "sua operação",
          data_referencia: payload.data_referencia || "",
          periodo_referencia: payload.periodo_referencia || "",
          dados_json: JSON.stringify(withBRL(payload.dados), null, 2),
          sinais_json: JSON.stringify({ sinais: payload.sinais || {}, sinal_geral: payload.sinal_geral }, null, 2),
          mensagem_anterior: lastMsg?.output_markdown || "(primeira mensagem — não há histórico)",
          instrucao_apresentacao: needsIntro
            ? "Esta é a PRIMEIRA mensagem para este gestor. Apresente-se em 2-3 linhas no início: quem você é (Théo, conselheiro do Conselho DS do DoctorSaaS) e o que ele vai passar a receber (pulso diário às 18h nos dias úteis e retrato da semana toda segunda de manhã). Depois siga com o conteúdo."
            : "NÃO se apresente — o gestor já te conhece. Vá direto ao conteúdo.",
        };
        const prompt = render(template.prompt_principal, vars) + "\n\n" + template.output_format_prompt;

        let aiResult: any = null;
        let aiError: string | null = null;
        try {
          aiResult = await callAI(aiCfg, [{ role: "user", content: prompt }], undefined, {
            maxTokens: template.max_tokens || 600,
          });
        } catch (e: any) {
          aiError = e?.message || "erro_llm";
        }

        const text = (aiResult?.content || "").trim();
        const valido = text.length >= 50 && text.length <= 3500;
        if (!aiError && valido) {
          bodyText = text;
          title = tipo === "diario" ? `💬 Théo — ${payload.data_referencia}` : payload.fallback_title;
          via = "ia";
          cost = aiResult?.usage?.estimatedCostUsd || 0;
        } else if (!aiError && !valido) {
          aiError = `output_invalido_len_${text.length}`;
        }
        r.ai_error = aiError || undefined;

        // Log em conselho_analises (não-bloqueante)
        try {
          await supabase.rpc("register_conselho_analise", {
            p_tenant_id: tid, p_tab_key: tabKey,
            p_dados_snapshot: payload.dados || {}, p_alertas_factuais: payload.sinais || {},
            p_filtros_aplicados: { tipo, dedupe_key: payload.dedupe_key },
            p_personas_ids: [], p_personas_snapshot: [],
            p_foco_mes: null, p_tom: "theo",
            p_prompt_final: prompt, p_output_markdown: bodyText || text || null,
            p_provider_usado: aiCfg.provider, p_model_usado: aiCfg.model,
            p_tokens_in: aiResult?.usage?.inputTokens || 0,
            p_tokens_out: aiResult?.usage?.outputTokens || 0,
            p_custo_estimado_usd: cost,
            p_duracao_ms: Date.now() - startedAt,
            p_status: via === "ia" ? "success" : "error",
            p_error_message: aiError,
            p_input_hash: `${tabKey}-${payload.dedupe_key}`,
            p_cache_horas: 0, p_cache_hit_de: null,
          });
        } catch (logErr) {
          console.error("[theo-dispatch] register_conselho_analise falhou:", logErr);
        }
      }

      if (!bodyText) bodyText = payload.fallback_body;

      if (dryRun) {
        r.via = via; r.title = title; r.preview = bodyText; r.custo_usd = cost; r.needs_intro = needsIntro;
        results.push(r);
        continue;
      }

      const { data: sent, error: nerr } = await supabase.rpc("notify_event", {
        p_tenant_id: tid, p_event_type: eventKey, p_dedupe_key: payload.dedupe_key,
        p_title: title, p_body: bodyText,
        p_metadata: { via, tipo, sinal_geral: payload.sinal_geral },
        p_action_url: null,
      });
      if (nerr) throw new Error(`notify_error: ${nerr.message}`);
      r.via = via; r.notify = sent; r.custo_usd = cost;

      // Marca apresentação apenas quando a intro realmente saiu (via IA, envio real)
      if (via === "ia" && needsIntro) {
        await supabase.from("theo_config").upsert(
          { tenant_id: tid, apresentado_em: new Date().toISOString() },
          { onConflict: "tenant_id" },
        );
      }
      results.push(r);
    } catch (e: any) {
      r.error = e?.message || String(e);
      results.push(r);
    }
  }

  return json({ tipo, dryRun, tenants: results.length, results });
});
