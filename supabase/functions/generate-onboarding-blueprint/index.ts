import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================================
// System prompt — especialista em operação de onboarding/implantação para
// revenda de software. Precisa produzir uma operação COMPLETA e utilizável
// mesmo com pouca informação do gestor (padrão de mercado quando faltar).
// ============================================================================
const SYSTEM_PROMPT = `Você é um especialista em estruturação de operações de Onboarding e Implantação para empresas que vendem e implantam software por assinatura (software houses, revendas de sistemas de gestão/ERP/PDV, provedores de internet, contabilidades). Sua tarefa é transformar a descrição do gestor em uma estrutura operacional completa e pronta para uso.

Sempre responda em português do Brasil.

REGRA CENTRAL: você DEVE produzir uma operação completa e utilizável mesmo quando o gestor der poucos detalhes. Onde faltar informação, complete com o padrão de mercado de revenda de software. Nunca devolva algo vago ("Etapa 1", "Fazer configuração"): cada etapa e cada item de checklist deve ser concreto e acionável.

DUAS FASES OBRIGATÓRIAS (gere um pipeline para cada, na sequência real de execução):
1. onboarding — tudo ANTES do cliente começar a operar: recepção/boas-vindas, coleta de dados e documentos, contrato e liberação financeira, levantamento de requisitos, migração da base de dados, cadastros iniciais (produtos, clientes, fornecedores).
2. implantacao — colocar o sistema para funcionar: parametrização, configuração fiscal/homologação (NF-e/NFC-e/SAT/certificado digital), integrações, treinamento dos usuários, acompanhamento do go-live e estabilização pós go-live.
Separe corretamente: coleta/migração/cadastro inicial = onboarding; parametrização/fiscal/treinamento/go-live = implantacao.

ETAPAS (stages):
- A primeira etapa do pipeline é o início; a última é a conclusão da fase.
- Defina SLA realista por etapa (sla_valor + sla_unidade "dias" ou "horas"). Ex.: coleta de documentos ~2 dias; migração de base ~3 a 5 dias; parametrização ~2 dias; treinamento ~1 dia; homologação fiscal ~2 dias.
- Marque pausa_sla=true nas etapas que normalmente ficam aguardando o cliente (ex.: aguardando documentos, aguardando agendamento) — nelas o relógio de SLA é congelado.

CHECKLIST por etapa:
- 2 a 5 itens concretos por etapa. Ex. em "Configuração Fiscal": "Instalar certificado digital A1", "Configurar série e numeração de NF-e", "Emitir nota de teste em homologação".
- Marque is_required=true nos itens que travam o avanço (contrato assinado, certificado instalado, base migrada e conferida).

CATÁLOGOS (sempre sugira, adaptando ao segmento descrito):
- demand_types: tipos de demanda. Padrão: Implantação nova, Migração de sistema, Expansão (novo PDV/filial), Retreinamento.
- training_types: tipos de treinamento. Padrão: Treinamento PDV/Frente de caixa, Treinamento Retaguarda/Gestão, Treinamento Fiscal, Treinamento Financeiro.
- pause_reasons: motivos de parada. Padrão: Aguardando documentação do cliente, Aguardando certificado digital, Aguardando agendamento do cliente, Pendência financeira, Aguardando terceiros (contador/operadora).
- accounting_fields: dados de contabilidade a coletar. Use tipo "select" quando houver opções fixas. Padrão: Regime tributário (select: Simples Nacional, Lucro Presumido, Lucro Real), CRT, Nome do contador, Contato do contador, Certificado digital (select: A1, A3, Não possui).
- vendor_return_reasons: motivos para devolver o cliente ao vendedor. Padrão: Escopo divergente do vendido, Cliente sem infraestrutura mínima, Dados de venda incompletos, Pendência contratual/financeira. Marque atribuivel_vendedor=true quando a causa for responsabilidade do vendedor.

Se o gestor descreveu o segmento (ex.: só PDV para varejo, ou provedor de internet), ADAPTE nomes e etapas a esse contexto, mantendo a completude. Preencha a estrutura chamando a função fornecida — não escreva texto fora dela.`;

// JSON Schema do blueprint (SLA em unidade humana; convertido p/ minutos no backend)
const BLUEPRINT_TOOL = [
  {
    type: "function",
    function: {
      name: "montar_operacao_onboarding",
      description: "Monta a estrutura completa de onboarding e implantação (pipelines, etapas, checklists e catálogos).",
      parameters: {
        type: "object",
        properties: {
          pipelines: {
            type: "array",
            description: "Um pipeline de fase 'onboarding' e um de fase 'implantacao'.",
            items: {
              type: "object",
              properties: {
                fase: { type: "string", enum: ["onboarding", "implantacao"] },
                nome: { type: "string" },
                descricao: { type: "string" },
                stages: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      nome: { type: "string" },
                      sla_valor: { type: "number" },
                      sla_unidade: { type: "string", enum: ["dias", "horas", "minutos"] },
                      pausa_sla: { type: "boolean" },
                      checklist: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            texto: { type: "string" },
                            is_required: { type: "boolean" },
                          },
                          required: ["texto"],
                        },
                      },
                    },
                    required: ["nome", "sla_valor", "sla_unidade"],
                  },
                },
              },
              required: ["fase", "nome", "stages"],
            },
          },
          demand_types: {
            type: "array",
            items: { type: "object", properties: { nome: { type: "string" }, descricao: { type: "string" } }, required: ["nome"] },
          },
          training_types: {
            type: "array",
            items: { type: "object", properties: { nome: { type: "string" }, conta_como_pdv: { type: "boolean" } }, required: ["nome"] },
          },
          pause_reasons: {
            type: "array",
            items: { type: "object", properties: { nome: { type: "string" } }, required: ["nome"] },
          },
          accounting_fields: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nome: { type: "string" },
                tipo: { type: "string", enum: ["text", "number", "date", "select"] },
                opcoes: { type: "array", items: { type: "string" } },
              },
              required: ["nome"],
            },
          },
          vendor_return_reasons: {
            type: "array",
            items: { type: "object", properties: { nome: { type: "string" }, atribuivel_vendedor: { type: "boolean" } }, required: ["nome"] },
          },
        },
        required: ["pipelines"],
      },
    },
  },
];

// ---------- helpers de normalização (não confiar cegamente no LLM) ----------
const MAX_PIPELINES = 4, MAX_STAGES = 12, MAX_CHECKLIST = 15, MAX_CATALOG = 25;

function str(v: any, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

function toMinutes(valor: any, unidade: any): number | null {
  const v = Number(valor);
  if (!isFinite(v) || v <= 0) return null;
  switch (String(unidade || "").toLowerCase()) {
    case "dias": case "dia": case "d": return Math.round(v * 1440);
    case "horas": case "hora": case "h": return Math.round(v * 60);
    case "minutos": case "minuto": case "min": case "m": return Math.round(v);
    default: return Math.round(v * 1440); // assume dias
  }
}

function parseBlueprint(raw: string): any {
  let s = (raw || "").trim();
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  return JSON.parse(s);
}

function normalizeCatalog(arr: any, map: (o: any) => any): any[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, MAX_CATALOG).map(map).filter((o: any) => o && o.nome);
}

function normalize(parsed: any) {
  const pipelinesRaw = Array.isArray(parsed?.pipelines) ? parsed.pipelines : [];
  const pipelines = pipelinesRaw.slice(0, MAX_PIPELINES).map((p: any) => {
    const fase = String(p?.fase || "").toLowerCase() === "implantacao" ? "implantacao" : "onboarding";
    const stagesRaw = Array.isArray(p?.stages) ? p.stages : [];
    const stages = stagesRaw.slice(0, MAX_STAGES).map((s: any) => {
      const chkRaw = Array.isArray(s?.checklist) ? s.checklist : [];
      const checklist = chkRaw.slice(0, MAX_CHECKLIST)
        .map((c: any) => ({ texto: str(c?.texto, 300), is_required: c?.is_required === true }))
        .filter((c: any) => c.texto);
      return {
        nome: str(s?.nome, 120) || "Etapa",
        sla_minutos: toMinutes(s?.sla_valor, s?.sla_unidade),
        pausa_sla: s?.pausa_sla === true,
        checklist,
      };
    }).filter((s: any) => s.nome);
    return { fase, nome: str(p?.nome, 120) || (fase === "onboarding" ? "Onboarding" : "Implantação"), descricao: str(p?.descricao, 500), stages };
  }).filter((p: any) => p.stages.length > 0);

  return {
    pipelines,
    demand_types: normalizeCatalog(parsed?.demand_types, (o) => ({ nome: str(o?.nome, 120), descricao: str(o?.descricao, 300) })),
    training_types: normalizeCatalog(parsed?.training_types, (o) => ({ nome: str(o?.nome, 120), conta_como_pdv: o?.conta_como_pdv === true })),
    pause_reasons: normalizeCatalog(parsed?.pause_reasons, (o) => ({ nome: str(o?.nome, 120) })),
    accounting_fields: normalizeCatalog(parsed?.accounting_fields, (o) => {
      const tipo = ["text", "number", "date", "select"].includes(o?.tipo) ? o.tipo : "text";
      const opcoes = tipo === "select" && Array.isArray(o?.opcoes)
        ? o.opcoes.map((x: any) => str(x, 100)).filter(Boolean).slice(0, 20)
        : null;
      return { nome: str(o?.nome, 120), tipo, opcoes };
    }),
    vendor_return_reasons: normalizeCatalog(parsed?.vendor_return_reasons, (o) => ({ nome: str(o?.nome, 120), atribuivel_vendedor: o?.atribuivel_vendedor === true })),
  };
}

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    const isInternalCall = token === serviceKey;

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    const tenantId: string | undefined = body?.tenant_id;
    const userPrompt: string = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!tenantId) return json({ success: false, error: "tenant_id_required", message: "tenant_id é obrigatório." }, 400);

    // ===== Permissão (admin do tenant ou super admin) — a EF consome budget de IA =====
    if (!isInternalCall) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
      if (userErr || !userData?.user) return json({ success: false, error: "Unauthorized" }, 401);

      const { data: prof } = await supabase
        .from("profiles")
        .select("tenant_id, role, is_super_admin")
        .eq("user_id", userData.user.id)
        .maybeSingle();

      const isSuper = prof?.is_super_admin === true || prof?.role === "super_admin";
      const isTenantAdmin = prof?.tenant_id === tenantId && prof?.role === "admin";
      if (!isSuper && !isTenantAdmin) {
        return json({ success: false, error: "forbidden", message: "Apenas administradores podem gerar a operação com IA." }, 403);
      }
    }

    // ===== Gate de budget mensal (mesmo mecanismo das demais funções de IA) =====
    const { data: cfg } = await supabase
      .from("configuracoes")
      .select("ai_monthly_budget_usd")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    const budget = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
    if (budget != null && budget > 0) {
      const { data: spendData } = await supabase.rpc("ai_month_spend_usd", { p_tenant_id: tenantId });
      const spend = Number(spendData) || 0;
      if (spend >= budget) {
        return json({ success: false, error: "budget_exceeded", message: `Teto de gasto de IA do mês atingido (US$ ${spend.toFixed(2)} / US$ ${budget.toFixed(2)}).` });
      }
    }

    // ===== Config de IA do tenant (modelo premium). Anula o system_prompt do tenant. =====
    const aiConfig = await getAIConfig(tenantId, supabase);
    if (!aiConfig) {
      return json({ success: false, error: "ai_not_configured", message: "Nenhuma IA configurada para este tenant. Acesse Configurações > Inteligência Artificial." });
    }
    const callConfig = { ...aiConfig, systemPrompt: null };

    const instruction = userPrompt
      ? `O gestor descreveu a operação da empresa assim:\n\n"""\n${userPrompt.slice(0, 6000)}\n"""\n\nGere a estrutura completa de onboarding e implantação com base nisso, completando o que faltar com o padrão de mercado de revenda de software. Responda apenas chamando a função (JSON válido, sem markdown).`
      : `O gestor não forneceu detalhes específicos. Gere uma estrutura completa e genérica de onboarding e implantação adequada a uma revenda de software de gestão (ERP/PDV) para o varejo, seguindo o padrão de mercado. Responda apenas chamando a função (JSON válido, sem markdown).`;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: instruction },
    ];

    // ===== Chamada ao LLM (modelo premium, function calling) =====
    let ai: any;
    try {
      ai = await callAI(callConfig, messages, BLUEPRINT_TOOL, { maxTokens: 8000 });
    } catch (aiError: any) {
      const msg = aiError?.message || "";
      console.error("[generate-onboarding-blueprint] AI error:", msg);
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return json({ success: false, error: "ai_key_invalid", message: "Chave de API inválida. Verifique em Configurações > Inteligência Artificial." });
      }
      if (msg.includes("429") || msg.includes("insufficient_quota") || msg.includes("quota")) {
        return json({ success: false, error: "ai_rate_limit", message: "Limite/créditos da API esgotados. Verifique seu plano no provedor de IA." });
      }
      return json({ success: false, error: "ai_error", message: `Erro na IA: ${msg.substring(0, 200)}` });
    }

    // Loga custo SEMPRE que houve chamada (o custo já ocorreu, independente do parse)
    try {
      await supabase.from("ai_usage_log").insert({
        tenant_id: tenantId,
        function_name: "generate-onboarding-blueprint",
        input_tokens: ai.usage.inputTokens,
        output_tokens: ai.usage.outputTokens,
        model: aiConfig.model,
        provider: aiConfig.provider,
        estimated_cost_usd: ai.usage.estimatedCostUsd,
      });
    } catch (_) { /* log não pode derrubar a resposta */ }

    // ===== Parse + normalização/validação do shape =====
    let parsed: any;
    try {
      parsed = parseBlueprint(ai.content);
    } catch (_) {
      return json({ success: false, error: "invalid_ai_output", message: "A IA retornou um formato inválido. Tente novamente." });
    }

    const blueprint = normalize(parsed);
    if (!blueprint.pipelines.length) {
      return json({ success: false, error: "empty_blueprint", message: "A IA não conseguiu gerar um pipeline válido. Tente descrever melhor a operação." });
    }

    return json({
      success: true,
      blueprint,
      usage: ai.usage,
      model: aiConfig.model,
      provider: aiConfig.provider,
    });
  } catch (error) {
    console.error("[generate-onboarding-blueprint] Error:", error);
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});
