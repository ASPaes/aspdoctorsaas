// Pauta do 1:1 pelo Théo, na Visão 360° do colaborador.
//
// Só roda quando um gestor clica em "Gerar pauta" (gasta a IA da empresa).
// Cada pauta gerada fica em `colaborador_pautas_ia`, que é o histórico da tela.
//
// Quem pode: head (equipe do setor) e admin. A checagem é a da própria Visão
// 360°: os números vêm de `get_colaborador_360` chamada com o TOKEN DO
// USUÁRIO, que recusa (42501) quem não pode ver aquela pessoa, e cujo
// `escopo = 'proprio'` identifica o operador, que não gera pauta.
// Atendimentos e jornada também são lidos com o token do usuário.
// Só o insert do resultado e o registro de custo usam service_role.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.85.0";
import { callAI, getAIConfig } from "../_shared/ai-client.ts";
import { lerResposta, maxTokensFor, montarPrompt, type ContextoPauta } from "./prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DIA = 86_400_000;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

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
    const alvo: string | null = typeof body?.user_id === "string" ? body.user_id : null;
    const tenantPedido: string | null = typeof body?.tenant_id === "string" ? body.tenant_id : null;
    const de = typeof body?.de === "string" ? body.de : new Date(Date.now() - 30 * DIA).toISOString();
    const ate = typeof body?.ate === "string" ? body.ate : new Date().toISOString();
    if (!alvo) return json({ ok: false, error: "user_id é obrigatório" }, 400);

    // 1. Permissão e números, com o token de quem pediu.
    const { data: v360, error: e360 } = await userClient.rpc("get_colaborador_360", {
      p_user_id: alvo, p_date_from: de, p_date_to: ate, p_tenant_id: tenantPedido,
    });
    if (e360) {
      const negado = (e360 as { code?: string }).code === "42501";
      return json({ ok: false, error: negado ? "Você não tem acesso a esta pessoa." : e360.message }, negado ? 403 : 500);
    }
    if (v360?.escopo === "proprio") {
      return json({ ok: false, error: "A pauta de 1:1 é gerada pelo head ou pelo administrador." }, 403);
    }
    const a = v360?.alvo ?? {};
    const m = a.metricas ?? null;
    const t = v360?.time ?? {};

    const { data: perfil } = await service.from("profiles").select("tenant_id").eq("user_id", alvo).maybeSingle();
    const tenantId = perfil?.tenant_id as string | undefined;
    if (!tenantId) return json({ ok: false, error: "Colaborador não encontrado" }, 404);

    // 2. Teto de gasto de IA do mês, o mesmo dos outros resumos.
    const { data: cfg } = await service.from("configuracoes").select("ai_monthly_budget_usd").eq("tenant_id", tenantId).maybeSingle();
    const teto = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
    if (teto != null && teto > 0) {
      const { data: gasto } = await service.rpc("ai_month_spend_usd", { p_tenant_id: tenantId });
      if ((Number(gasto) || 0) >= teto) {
        return json({ ok: false, motivo: "teto", error: "O teto de gasto de IA do mês foi atingido. A pauta volta no mês que vem ou quando o administrador aumentar o teto." });
      }
    }
    const ai = await getAIConfig(tenantId, service);
    if (!ai) return json({ ok: false, motivo: "sem_ia", error: "A IA não está configurada para esta empresa. Configure em Configurações › Inteligência artificial." });

    // 3. Assuntos, comentários e jornada, ainda com o token do usuário.
    const [ats, jor] = await Promise.all([
      userClient.from("support_attendances")
        .select("opened_at, ai_category, csat_score, support_csat(score, reason, responded_at)")
        .eq("assigned_to", alvo).eq("tenant_id", tenantId)
        .gte("opened_at", de).lte("opened_at", ate)
        .order("opened_at", { ascending: false }).limit(1000),
      userClient.rpc("get_atendimento_jornada", {
        p_tenant_id: tenantId, p_date_from: de, p_date_to: ate, p_department_id: null, p_agent_id: alvo,
      }),
    ]);

    const porAssunto = new Map<string, { n: number; soma: number; notas: number }>();
    const comentarios: { nota: number; texto: string; quando: string }[] = [];
    for (const r of (ats.data ?? []) as any[]) {
      const cs = Array.isArray(r.support_csat) ? r.support_csat[0] : r.support_csat;
      const nota = cs?.score ?? r.csat_score ?? null;
      const k = r.ai_category || "Sem assunto";
      const g = porAssunto.get(k) ?? { n: 0, soma: 0, notas: 0 };
      g.n++;
      if (nota != null) { g.soma += nota; g.notas++; }
      porAssunto.set(k, g);
      if (nota != null && cs?.reason) comentarios.push({ nota, texto: cs.reason, quando: cs.responded_at ?? r.opened_at });
    }
    comentarios.sort((x, y) => (x.quando < y.quando ? 1 : -1));
    // Os mais baixos primeiro entre os recentes: é deles que sai o "conversar".
    const escolhidos = [
      ...comentarios.filter((c) => c.nota <= 3).slice(0, 5),
      ...comentarios.filter((c) => c.nota > 3).slice(0, 5),
    ];

    let jornada: ContextoPauta["jornada"] = null;
    const jd = jor.data as any;
    if (!jor.error && jd?.totais && Number(jd.totais.dias) > 0) {
      let acima = 0;
      const porMotivo = new Map<string, number>();
      for (const p of jd.pausas ?? []) {
        if (p.previsto_min == null || p.em_andamento) continue;
        const extra = Number(p.segundos) - Number(p.previsto_min) * 60;
        if (extra > 60) { acima += extra; porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + extra); }
      }
      const top = [...porMotivo.entries()].sort((x, y) => y[1] - x[1])[0];
      jornada = {
        diasComExpediente: Number(jd.totais.dias),
        pausaMin: Math.round(Number(jd.totais.pausa_seg) / 60),
        acimaDoPrevistoMin: Math.round(acima / 60),
        motivoMaisAcima: top?.[0] ?? null,
      };
    }

    const maisAntigo = a.agora?.ticket_mais_antigo ? Math.floor((Date.now() - new Date(a.agora.ticket_mais_antigo).getTime()) / DIA) : null;
    const ctx: ContextoPauta = {
      nome: a.nome ?? "Colaborador",
      cargo: a.cargo ?? null,
      setor: a.setor ?? null,
      periodo: { de, ate },
      grupo: m?.grupo === "tenant" ? "tenant" : "setor",
      pessoasNoGrupo: num(m?.n) ?? num(t?.n),
      encerrados: { valor: num(m?.encerrados), time: num(t?.encerrados), posicao: num(m?.pos?.encerrados) },
      csat: { valor: num(m?.csat), time: num(t?.csat), posicao: num(m?.pos?.csat), notas: Number(m?.csat_n ?? 0) },
      primeiraRespostaSeg: { valor: num(m?.frt_p50), time: num(t?.frt_p50), posicao: num(m?.pos?.frt) },
      tmaSeg: { valor: num(m?.tma_p50), time: num(t?.tma_p50), posicao: num(m?.pos?.tma) },
      resolvidoPrimeiroContatoPct: { valor: num(m?.fcr_pct), time: num(t?.fcr_pct), posicao: num(m?.pos?.fcr) },
      reaberturaPct: num(m?.reabertura_pct),
      ticketsResolvidos: Number(m?.tk_resolvidos ?? 0),
      ticketsAbertos: Number(a.agora?.tickets_abertos ?? 0),
      ticketMaisAntigoDias: maisAntigo,
      assuntos: [...porAssunto.entries()].sort((x, y) => y[1].n - x[1].n).slice(0, 6)
        .map(([nome, g]) => ({ nome, n: g.n, notas: g.notas, csat: g.notas ? g.soma / g.notas : null })),
      comentarios: escolhidos.map((c) => ({ nota: c.nota, texto: c.texto })),
      jornada,
    };

    // 4. IA.
    const { system, user: prompt } = montarPrompt(ctx);
    const r = await callAI(ai, [{ role: "system", content: system }, { role: "user", content: prompt }], undefined, { maxTokens: maxTokensFor(ai.model) });
    if (!(r.content ?? "").trim()) {
      console.error("[colaborador-pauta-360] resposta vazia; output_tokens:", r.usage.outputTokens);
      return json({ ok: false, error: "A IA não devolveu texto. Tente de novo." }, 502);
    }
    const lido = lerResposta(r.content ?? "");
    if (!lido) {
      console.error("[colaborador-pauta-360] resposta ilegível:", (r.content ?? "").slice(0, 300));
      return json({ ok: false, error: "A IA respondeu num formato inesperado. Tente de novo." }, 502);
    }

    // 5. Guarda e registra o custo.
    const { data: linha, error: insErr } = await service.from("colaborador_pautas_ia").insert({
      tenant_id: tenantId, colaborador_id: alvo, criado_por: user.id,
      periodo_de: de, periodo_ate: ate,
      resumo: lido.resumo, reconhecer: lido.reconhecer, conversar: lido.conversar, desenvolver: lido.desenvolver,
      modelo: ai.model, provider: ai.provider,
      input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens, custo_usd: r.usage.estimatedCostUsd,
    }).select("id, criado_em, criado_por, periodo_de, periodo_ate, resumo, reconhecer, conversar, desenvolver").single();
    if (insErr) {
      console.error("[colaborador-pauta-360] insert:", insErr.message);
      return json({ ok: false, error: "A pauta foi gerada mas não deu para guardar. Tente de novo." }, 500);
    }

    try {
      await service.from("ai_usage_log").insert({
        tenant_id: tenantId, function_name: "colaborador-pauta-360", model: ai.model, provider: ai.provider,
        input_tokens: r.usage.inputTokens, output_tokens: r.usage.outputTokens, estimated_cost_usd: r.usage.estimatedCostUsd,
      });
    } catch (e) {
      console.warn("[colaborador-pauta-360] ai_usage_log:", e);
    }

    return json({ ok: true, pauta: linha });
  } catch (e) {
    console.error("[colaborador-pauta-360] erro:", e);
    return json({ ok: false, error: (e as Error)?.message ?? "Erro interno" }, 500);
  }
});
