// Resumo do Théo na Visão 360° do cliente.
//
// Só roda quando alguém clica em "Gerar resumo" (decisão do Alexandre: gasta a
// IA da empresa, então é a pessoa que decide). Cada resumo gerado fica em
// `cliente_resumos_ia`, que é o histórico que a tela mostra.
//
// Os dados do cliente são lidos com o TOKEN DO USUÁRIO: o resumo só pode falar
// do que a pessoa já enxerga. Um operador que vê só o setor dele não pode
// receber, via IA, o resumo dos atendimentos de outro setor.
// Só o insert do resultado e o registro de custo usam service_role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";
import { callAI, getAIConfig } from "../_shared/ai-client.ts";
import { lerResposta, montarPrompt, type Contexto } from "./prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DIA = 86_400_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors, status: 204 });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("authorization") ?? "" } },
  });

  try {
    const { data: u } = await userClient.auth.getUser();
    const user = u?.user;
    if (!user) return json({ ok: false, error: "Não autenticado" }, 401);

    const body = await req.json().catch(() => ({}));
    const clienteId: string | null = typeof body?.cliente_id === "string" ? body.cliente_id : null;
    if (!clienteId) return json({ ok: false, error: "cliente_id é obrigatório" }, 400);

    // Com o token do usuário: se ele não enxerga o cliente, para aqui.
    const { data: cliente } = await userClient
      .from("clientes")
      .select("id, tenant_id, nome_fantasia, razao_social, cancelado, data_ativacao, data_cadastro, cert_a1_vencimento")
      .eq("id", clienteId)
      .maybeSingle();
    if (!cliente) return json({ ok: false, error: "Cliente não encontrado" }, 404);
    const tenantId = cliente.tenant_id as string;

    // Teto de gasto de IA do mês, o mesmo do resumo de sentimento.
    const { data: cfg } = await service
      .from("configuracoes")
      .select("ai_monthly_budget_usd")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const teto = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
    if (teto != null && teto > 0) {
      const { data: gasto } = await service.rpc("ai_month_spend_usd", { p_tenant_id: tenantId });
      if ((Number(gasto) || 0) >= teto) {
        return json({ ok: false, motivo: "teto", error: "O teto de gasto de IA do mês foi atingido. O resumo volta no mês que vem ou quando o administrador aumentar o teto." });
      }
    }

    const ai = await getAIConfig(tenantId, service);
    if (!ai) return json({ ok: false, motivo: "sem_ia", error: "A IA não está configurada para esta empresa. Configure em Configurações › Inteligência artificial." });

    const agora = Date.now();
    const desde90 = new Date(agora - 90 * DIA).toISOString();
    const hoje = new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10);
    const ha12m = new Date(agora - 365 * DIA - 3 * 3_600_000).toISOString().slice(0, 10);

    const [ats, tks, mrrHoje, mrr12, abertos] = await Promise.all([
      userClient.from("support_attendances")
        .select("attendance_code, opened_at, status, resolucao, ai_category, ai_summary, csat_score, support_csat(score, reason)")
        .eq("cliente_id", clienteId).gte("opened_at", desde90)
        .order("opened_at", { ascending: false }).limit(40),
      userClient.from("support_tickets")
        .select("ticket_code, assunto, aberto_em, concluido_em, ticket_statuses!support_tickets_status_id_fkey(name, is_terminal)")
        .eq("cliente_id", clienteId).is("deleted_at", null)
        .order("aberto_em", { ascending: false }).limit(20),
      userClient.rpc("fn_mrr_cliente_em", { p_tenant: tenantId, p_cliente: clienteId, p_data: hoje }),
      userClient.rpc("fn_mrr_cliente_em", { p_tenant: tenantId, p_cliente: clienteId, p_data: ha12m }),
      // Some sozinho para quem não tem o Financeiro: o RLS devolve zero linhas.
      userClient.from("vw_fin_titulos_abertos")
        .select("vencimento, valor, situacao, dias_atraso")
        .eq("cliente_id", clienteId),
    ]);

    const ctx: Contexto = {
      nome: cliente.nome_fantasia || cliente.razao_social || "Cliente",
      cancelado: !!cliente.cancelado,
      clienteDesde: cliente.data_ativacao || cliente.data_cadastro,
      certA1: cliente.cert_a1_vencimento,
      mrrHoje: Number(mrrHoje.data) || 0,
      mrr12m: Number(mrr12.data) || 0,
      atendimentos: (ats.data ?? []).map((a: any) => {
        const cs = Array.isArray(a.support_csat) ? a.support_csat[0] : a.support_csat;
        return {
          codigo: a.attendance_code, data: a.opened_at, status: a.status, resolucao: a.resolucao,
          assunto: a.ai_category, resumo: a.ai_summary, nota: cs?.score ?? a.csat_score ?? null, comentario: cs?.reason ?? null,
        };
      }),
      tickets: (tks.data ?? []).map((t: any) => ({
        codigo: t.ticket_code, assunto: t.assunto, aberto: t.aberto_em, concluido: t.concluido_em,
        status: t.ticket_statuses?.name ?? null, encerrado: t.ticket_statuses ? !!t.ticket_statuses.is_terminal : !!t.concluido_em,
      })),
      titulosAbertos: (abertos.data ?? []).map((t: any) => ({
        vencimento: t.vencimento, valor: Number(t.valor) || 0, situacao: t.situacao, diasAtraso: Number(t.dias_atraso) || 0,
      })),
    };

    const { system, user: prompt } = montarPrompt(ctx);
    const r = await callAI(ai, [{ role: "system", content: system }, { role: "user", content: prompt }], undefined, { maxTokens: 1200 });
    const lido = lerResposta(r.content ?? "");
    if (!lido) {
      console.error("[cliente-resumo-360] resposta ilegível:", (r.content ?? "").slice(0, 300));
      return json({ ok: false, error: "A IA respondeu num formato inesperado. Tente de novo." }, 502);
    }

    const { data: linha, error: insErr } = await service.from("cliente_resumos_ia").insert({
      tenant_id: tenantId, cliente_id: clienteId, criado_por: user.id,
      resumo: lido.resumo, pontos: lido.pontos,
      modelo: ai.model, provider: ai.provider,
      input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens, custo_usd: r.usage.estimatedCostUsd,
    }).select("id, criado_em, criado_por, resumo, pontos").single();
    if (insErr) {
      console.error("[cliente-resumo-360] insert:", insErr.message);
      return json({ ok: false, error: "O resumo foi gerado mas não deu para guardar. Tente de novo." }, 500);
    }

    try {
      await service.from("ai_usage_log").insert({
        tenant_id: tenantId, function_name: "cliente-resumo-360", model: ai.model, provider: ai.provider,
        input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens, estimated_cost_usd: r.usage.estimatedCostUsd,
      });
    } catch (e) {
      console.warn("[cliente-resumo-360] ai_usage_log:", e);
    }

    return json({ ok: true, resumo: linha });
  } catch (e) {
    console.error("[cliente-resumo-360] erro:", e);
    return json({ ok: false, error: (e as Error)?.message ?? "Erro interno" }, 500);
  }
});
