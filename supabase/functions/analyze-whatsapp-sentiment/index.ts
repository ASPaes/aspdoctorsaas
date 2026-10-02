import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";
import { notifyEvent } from "../_shared/notify.ts";
import {
  selecionarMensagens, formatarMensagens, montarPrompt, FERRAMENTA_ANALISE,
  ehCandidatoChurn, ehAlertaChurn, ehCandidatoIrritacao, ehAlertaCancelamentoIndefinido, ehRecorrente, ehConversa, ocorrenciasDe,
  MAX_MENSAGENS, RECORRENCIA_JANELA_DIAS, RECORRENCIA_PAUSA_DIAS, ALVOS_RECORRENCIA,
} from "./prompt.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Piso da janela de analise quando a conversa nao tem atendimento aberto.
// Ver o comentario na montagem de `windowStart` — sem esse piso a analise lia a
// conversa inteira e o alerta de churn citava mensagem de dias atras.
const WINDOW_FALLBACK_HOURS = 6;

// === Modelo utilitario decidido pela PLATAFORMA (nunca pelo tenant) ===
// Classificacao de sentimento roda num modelo barato, independente do modelo
// premium que o tenant configurou. Para provider 'custom'/desconhecido nao
// arrisca trocar (pode nao existir no endpoint), usa o fallback do proprio tenant.
function utilityModelFor(provider: string, fallback: string): string {
  switch (provider) {
    case "openai": return "gpt-4o-mini";
    case "anthropic": return "claude-3-5-haiku-20241022";
    case "gemini": return "gemini-1.5-flash";
    default: return fallback;
  }
}

async function checkRateLimit(
  supabase: any,
  tenantId: string,
  functionName: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number; logId?: string }> {
  try {
    const { data: configs } = await supabase
      .from('ai_rate_limit_config')
      .select('max_calls, window_seconds, tenant_id')
      .eq('function_name', functionName)
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('tenant_id', { ascending: false, nullsFirst: false })
      .limit(2);

    const config = configs?.[0] ?? { max_calls: 10, window_seconds: 60 };
    const windowSeconds = config.window_seconds;
    const maxCalls = config.max_calls;
    const windowStart = new Date(Date.now() - windowSeconds * 1000).toISOString();

    const { count } = await supabase
      .from('ai_usage_log')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('function_name', functionName)
      .gte('called_at', windowStart);

    if ((count ?? 0) >= maxCalls) {
      return { allowed: false, retryAfterSeconds: windowSeconds };
    }

    const logId = crypto.randomUUID();
    supabase
      .from('ai_usage_log')
      .insert({ id: logId, tenant_id: tenantId, function_name: functionName, model: null, provider: null, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0 })
      .then(() => {});

    return { allowed: true, logId };
  } catch {
    return { allowed: true };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    const isInternalCall = token === serviceKey;
    // Token de avaliacao: so libera o dryRun (conferido abaixo), nunca analise
    // real. Existe para repassar casos reais pela regra sem a chave de servico.
    // Sem o secret ANALYZE_DRYRUN_TOKEN configurado, nao vale nada.
    const evalToken = Deno.env.get("ANALYZE_DRYRUN_TOKEN") ?? "";
    const isEvalCall = evalToken.length >= 32 && req.headers.get("x-dryrun-token") === evalToken;

    if (!isInternalCall && !isEvalCall) {
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser(token);
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    // dryRun: so analisa e devolve o resultado, sem gravar nem avisar — para
    // repassar casos reais pela regra (ex.: os alertas de um periodo). `ate`
    // reconstroi o momento: le o atendimento que estava aberto naquela hora e
    // so as mensagens ate ela. Apenas chamada interna (service_role).
    const body = await req.json();
    const conversationId = body?.conversationId;
    // Pedido de teste de quem nao e interno e recusado, nunca rebaixado para
    // analise real: rebaixar gravaria e poderia mandar alerta de verdade. E o
    // token de avaliacao sem dryRun tambem: ele nao autentica analise real.
    if ((body?.dryRun === true && !isInternalCall && !isEvalCall) || (isEvalCall && body?.dryRun !== true)) {
      return new Response(JSON.stringify({ success: false, error: "dry_run_internal_only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const dryRun = body?.dryRun === true;
    const ate: string | null = dryRun && typeof body?.ate === "string" ? body.ate : null;
    // Analise de um atendimento especifico — e como o finalize-attendance pede a
    // rodada do fechamento. So chamada interna.
    const attendanceIdParam: string | null = isInternalCall && typeof body?.attendanceId === "string" ? body.attendanceId : null;
    const origem: "durante" | "fechamento" = attendanceIdParam && body?.origem === "fechamento" ? "fechamento" : "durante";
    if (!conversationId) {
      return new Response(JSON.stringify({ success: false, error: "conversationId is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: convData } = await supabase
      .from("whatsapp_conversations")
      .select("tenant_id, contact_id, whatsapp_contacts(id, name, phone_number)")
      .eq("id", conversationId)
      .single();

    if (!convData) {
      return new Response(JSON.stringify({ success: false, error: "Conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // === GATE 1: chave liga/desliga + teto de gasto (por tenant) ===
    const { data: cfg } = await supabase
      .from("configuracoes")
      .select("sentiment_analysis_enabled, ai_monthly_budget_usd, churn_alert_enabled")
      .eq("tenant_id", convData.tenant_id)
      .maybeSingle();

    if (cfg && cfg.sentiment_analysis_enabled === false) {
      return new Response(
        JSON.stringify({ success: false, error: "sentiment_disabled", message: "Analise de sentimento desativada para este tenant." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const budget = cfg?.ai_monthly_budget_usd != null ? Number(cfg.ai_monthly_budget_usd) : null;
    if (budget != null && budget > 0) {
      const { data: spendData } = await supabase.rpc("ai_month_spend_usd", { p_tenant_id: convData.tenant_id });
      const spend = Number(spendData) || 0;
      if (spend >= budget) {
        return new Response(
          JSON.stringify({ success: false, error: "budget_exceeded", message: `Teto de gasto de IA do mes atingido (US$ ${spend.toFixed(2)} / US$ ${budget.toFixed(2)}).` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const rateLimit = await checkRateLimit(supabase, convData.tenant_id, 'analyze-whatsapp-sentiment');
    if (!rateLimit.allowed) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'rate_limit_exceeded',
          message: `Limite de uso de IA atingido. Tente novamente em ${rateLimit.retryAfterSeconds} segundos.`,
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiConfig = await getAIConfig(convData.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "ai_not_configured",
          message: "Nenhuma IA configurada para este tenant. Acesse Configuracoes > Inteligencia Artificial para configurar.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Janela de analise. O corte precisa existir SEMPRE: sem ele a busca pega as
    // ultimas 20 mensagens da conversa INTEIRA e, como a thread de um contato e
    // continua (nunca "termina"), a IA cita como evidencia de churn uma frase de
    // dias atras. Foi o alerta de 02/09 citando mensagem de 27/08.
    //
    // Preferencia e o atendimento aberto. Quando nao ha nenhum, cai no piso de
    // WINDOW_FALLBACK_HOURS — que e o caso real, uma corrida: o processor dispara
    // a analise ao RECEBER a mensagem e o atendimento so e gravado segundos
    // depois, entao aqui a busca por atendimento aberto volta vazia.
    let attQuery = supabase
      .from("support_attendances")
      .select("id, opened_at, closed_at, assigned_to, department_id, cliente_id")
      .eq("conversation_id", conversationId);
    attQuery = attendanceIdParam ? attQuery.eq("id", attendanceIdParam)
      : ate ? attQuery.lte("opened_at", ate)
      : attQuery.is("closed_at", null);
    const { data: att } = await attQuery
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const agoraMs = ate ? new Date(ate).getTime() : Date.now();
    const windowStart =
      att?.opened_at ??
      new Date(agoraMs - WINDOW_FALLBACK_HOURS * 60 * 60 * 1000).toISOString();

    // O atendimento INTEIRO, nao as ultimas 20: com 20, imagens e mensagens de
    // sistema empurravam para fora justamente o comeco, onde o cliente diz do que
    // se trata (alerta de 30/09: "como eu cancelo um valor que passei no sistema"
    // ficou de fora e sobrou so "Entao preciso cancelar"). 500 e so a trava da
    // busca (p90 do atendimento e 46); o teto do prompt e MAX_MENSAGENS, e quem
    // passa dele perde o meio, nunca o comeco nem o fim (selecionarMensagens).
    let msgQuery = supabase
      .from("whatsapp_messages")
      .select("content, timestamp, audio_transcription, message_type, is_from_me")
      .eq("conversation_id", conversationId)
      .gte("timestamp", windowStart);
    const windowEnd = ate ?? (attendanceIdParam ? att?.closed_at : null);
    if (windowEnd) msgQuery = msgQuery.lte("timestamp", windowEnd);
    const { data: messages, error: messagesError } = await msgQuery
      .order("timestamp", { ascending: true })
      .limit(500);

    if (messagesError) throw messagesError;

    const conversa = (messages || []).filter(ehConversa);
    const clientMessagesCount = conversa.filter((m: any) => !m.is_from_me).length;
    // Basta 1 mensagem do cliente. O minimo era 3, mas contava a mensagem de
    // sistema "Atendimento aberto" (gravada com is_from_me=false) — tirando ela,
    // "Quero fazer o cancelamento do sistema" dito em 2 mensagens nem era lido.
    // A analise periodica so dispara na 5a mensagem; quem chega aqui com menos
    // e o disparo por palavra-chave, que e justamente o pedido direto.
    if (clientMessagesCount < 1) {
      return new Response(
        JSON.stringify({ success: false, error: "insufficient_messages", message: "Nenhuma mensagem do cliente no atendimento." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const selecionadas = selecionarMensagens(conversa);
    const omitidas = conversa.length > MAX_MENSAGENS ? conversa.length - selecionadas.length : 0;
    const prompt = montarPrompt(formatarMensagens(selecionadas, omitidas));
    const tools = [FERRAMENTA_ANALISE];

    // Acumuladores de custo (tier1 + tier2)
    let totalIn = 0, totalOut = 0, totalCost = 0;
    let modelsUsed = "";
    let result: any;
    try {
      // === TIER 1: modelo utilitario barato (mini) — roda em 100% das chamadas ===
      const tier1Model = utilityModelFor(aiConfig.provider, aiConfig.model);
      const tier1Config = { ...aiConfig, model: tier1Model };
      const r1 = await callAI(tier1Config, [{ role: "user", content: prompt }], tools);
      totalIn += r1.usage.inputTokens; totalOut += r1.usage.outputTokens; totalCost += r1.usage.estimatedCostUsd;
      modelsUsed = tier1Model;
      result = JSON.parse(r1.content);

      // === TIER 2: so escala para o modelo premium quando o mini sinaliza
      // cancelamento ou irritacao — confirma antes de avisar ou de gravar a
      // ocorrencia (que pesa na nota do cliente e do colaborador). Raro => barato.
      const isChurnCandidate = ehCandidatoChurn(result) || ehCandidatoIrritacao(result) ||
        (result?.cancel_target === "indefinido" && typeof result?.churn_evidence === "string" && result.churn_evidence.trim().length > 0);
      const premiumModel = aiConfig.model;
      if (isChurnCandidate && premiumModel && premiumModel !== tier1Model) {
        try {
          const r2 = await callAI(aiConfig, [{ role: "user", content: prompt }], tools);
          totalIn += r2.usage.inputTokens; totalOut += r2.usage.outputTokens; totalCost += r2.usage.estimatedCostUsd;
          modelsUsed = `${tier1Model}+${premiumModel}`;
          const confirmed = JSON.parse(r2.content);
          // Veredito do premium prevalece (mais preciso para o high-stakes)
          result = confirmed;
        } catch (e2: any) {
          console.error("[analyze-sentiment] tier2 confirm falhou, mantendo tier1:", e2?.message || e2);
        }
      }

      if (rateLimit.logId) {
        await supabase.from('ai_usage_log').update({
          input_tokens: totalIn,
          output_tokens: totalOut,
          estimated_cost_usd: totalCost,
          model: modelsUsed,
          provider: aiConfig.provider,
        }).eq('id', rateLimit.logId);
      }
    } catch (aiError: any) {
      const msg = aiError.message || "";
      console.error("[analyze-sentiment] AI error:", msg);
      if (msg.includes("401") || msg.includes("invalid_api_key")) {
        return new Response(JSON.stringify({ success: false, error: "ai_key_invalid", message: "Chave de API invalida. Verifique em Configuracoes > Inteligencia Artificial." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (msg.includes("429") || msg.includes("insufficient_quota") || msg.includes("quota")) {
        return new Response(JSON.stringify({ success: false, error: "rate_limit", message: "Limite/creditos da API esgotados. Verifique seu plano no provedor de IA." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: false, error: "ai_error", message: `Erro na IA: ${msg.substring(0, 200)}` }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!["positive", "neutral", "negative"].includes(result.sentiment)) {
      throw new Error("Invalid sentiment value");
    }

    const ehChurn = ehAlertaChurn(result);
    const ehIndefinido = !ehChurn && ehAlertaCancelamentoIndefinido(result);

    if (dryRun) {
      return new Response(JSON.stringify({ success: true, dryRun: true, result, alerta: ehChurn ? "churn" : ehIndefinido ? "cancelamento_indefinido" : null, ocorrencias: ocorrenciasDe(result), models: modelsUsed, mensagens: selecionadas.length }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: analysis, error: upsertError } = await supabase
      .from("whatsapp_sentiment_analysis")
      .upsert({
        conversation_id: conversationId,
        contact_id: convData.contact_id,
        tenant_id: convData.tenant_id,
        sentiment: result.sentiment,
        confidence: result.confidence,
        // O tooltip "Clima ao vivo" mostra este texto inteiro. Cortar em 100
        // deixava a frase parada no meio da palavra (DEM-0518); 500 e o mesmo
        // teto que o finalize-attendance usa ao reescrever o resumo no fechamento.
        summary: result.summary?.substring(0, 500),
        keywords: result.keywords || [],
        // A faixa de "abrir ticket de CS" no chat le esta coluna: so liga com
        // pedido de cancelamento, nunca com o needs_cs_ticket cru da IA. Irritacao
        // isolada nao liga — vira ocorrencia e so avisa quando se repete.
        needs_cs_ticket: ehCandidatoChurn(result) || ehIndefinido,
        cs_ticket_reason: ehCandidatoChurn(result) || ehIndefinido ? (result.cs_ticket_reason || result.summary)?.substring(0, 200) || null : null,
      }, { onConflict: "conversation_id" })
      .select()
      .single();

    if (upsertError) throw upsertError;

    // Ocorrencias (historico da Visao 360 e base da recorrencia). Uma por
    // (atendimento, tipo, alvo): a rodada seguinte que redetecta a mesma
    // irritacao e ignorada pelo indice unico. Sem atendimento (corrida da
    // abertura) nao grava — a rodada do fechamento pega.
    const ocorrencias = ocorrenciasDe(result);
    let novasOcorrencias: { tipo: string; alvo: string }[] = [];
    if (att?.id && ocorrencias.length > 0) {
      const motivo = (result.cs_ticket_reason || result.summary || "").toString().substring(0, 300) || null;
      const { data: inseridas, error: ocErr } = await supabase
        .from("atendimento_ocorrencias")
        .upsert(ocorrencias.map((o) => ({
          tenant_id: convData.tenant_id,
          conversation_id: conversationId,
          attendance_id: att.id,
          cliente_id: att.cliente_id ?? null,
          contact_id: convData.contact_id ?? null,
          tipo: o.tipo,
          alvo: o.alvo,
          // So irritacao com o ATENDIMENTO e do colaborador; fila sem dono
          // (assigned_to nulo) fica no setor.
          responsavel_id: o.alvo === "atendimento" ? (att.assigned_to ?? null) : null,
          department_id: att.department_id ?? null,
          trecho: o.trecho.substring(0, 500),
          motivo,
          confianca: Number(result.confidence) >= 0 && Number(result.confidence) <= 1 ? Number(result.confidence) : null,
          origem,
          modelo: modelsUsed,
        })), { onConflict: "attendance_id,tipo,alvo", ignoreDuplicates: true })
        .select("tipo, alvo");
      if (ocErr) console.error("[analyze-sentiment] falha ao gravar ocorrencia:", ocErr.message);
      novasOcorrencias = inseridas ?? [];
    }

    // Alerta imediato. Quem decide e o codigo, com o que a IA classificou (ver
    // prompt.ts): cancelar o CONTRATO, ou pedido de cancelamento sem dizer de
    // que ("Possivel cancelamento"). Irritacao nao avisa aqui — so pela
    // recorrencia, mais abaixo.
    // Sem a exigencia de duas analises seguidas: com a analise a cada 5
    // mensagens ela atrasava o alerta ate o cliente repetir — quem confirma e o
    // modelo premium (tier2) na mesma chamada.
    const churnGate = ehChurn || ehIndefinido;

    // Descarte manual: um admin/head pode derrubar o sinal de risco desta
    // conversa (falso positivo). Vale enquanto durar o atendimento em que foi
    // descartado — `fn_churn_descarte_ativo` compara a ancora com o
    // atendimento ativo de agora. Consultado so quando o gate ja passou, que e
    // raro: nao adiciona chamada ao caminho comum.
    let churnDescartado = false;
    if (churnGate) {
      const { data: descarte } = await supabase.rpc("fn_churn_descarte_ativo", {
        p_conversation_id: conversationId,
      });
      churnDescartado = descarte === true;
      if (churnDescartado) {
        console.log(`[churn-alert] descartado manualmente para conversation ${conversationId}`);
      }
    }

    if (churnGate && !churnDescartado) {
      try {
        if (cfg?.churn_alert_enabled) {
          const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const { data: claimed } = await supabase
            .from("whatsapp_sentiment_analysis")
            .update({ churn_alerted_at: new Date().toISOString() })
            .eq("conversation_id", conversationId)
            .or(`churn_alerted_at.is.null,churn_alerted_at.lt.${cutoffIso}`)
            .select("id");

          if (claimed && claimed.length > 0) {
            const contact: any = (convData as any).whatsapp_contacts || {};
            const contactName = contact.name || contact.phone_number || "Cliente";
            const contactPhone = contact.phone_number || "";
            const reason = (result.cs_ticket_reason || result.summary || "Sinal de churn detectado").toString();
            const evidencia = result.churn_evidence;

            const title = ehChurn ? `⚠️ Risco de churn: ${contactName}` : `❓ Possível cancelamento — confira: ${contactName}`;

            await notifyEvent(
              supabase,
              convData.tenant_id,
              "churn_alert",
              conversationId,
              title,
              `Cliente: ${contactName} (${contactPhone})\nMotivo: ${reason.substring(0, 400)}\nTrecho: "${(evidencia || "").substring(0, 200)}"\nAbra o DoctorSaaS para ver a conversa.`,
              { source: "churn_alert", conversation_id: conversationId, contact_name: contactName, contact_phone: contactPhone },
              `/whatsapp?conversation=${conversationId}`
            );

            console.log(`[churn-alert] fired for conversation ${conversationId} tenant ${convData.tenant_id}`);
          } else {
            console.log(`[churn-alert] cooldown active for conversation ${conversationId}`);
          }
        }
      } catch (alertErr: any) {
        console.error("[churn-alert] unexpected error:", alertErr?.message || alertErr);
      }
    }

    // Irritacao recorrente: so quando ESTA analise gravou uma ocorrencia nova
    // contra o atendimento ou o produto (redeteccao no mesmo atendimento nao
    // conta). Conta atendimentos do cliente na janela — sem cliente vinculado,
    // conta pelo contato. Um aviso por cliente a cada RECORRENCIA_PAUSA_DIAS.
    const novaIrritacao = novasOcorrencias.some((o) => o.tipo === "irritacao" && (ALVOS_RECORRENCIA as readonly string[]).includes(o.alvo));
    if (novaIrritacao && cfg?.churn_alert_enabled) {
      try {
        const porCliente = !!att?.cliente_id;
        const chave = porCliente ? `recorrencia:cliente:${att.cliente_id}` : `recorrencia:contato:${convData.contact_id}`;
        const desde = new Date(Date.now() - RECORRENCIA_JANELA_DIAS * 86400000).toISOString();
        let q = supabase
          .from("atendimento_ocorrencias")
          .select("attendance_id, alvo, trecho, detectado_em")
          .eq("tenant_id", convData.tenant_id)
          .eq("tipo", "irritacao")
          .in("alvo", [...ALVOS_RECORRENCIA])
          .gte("detectado_em", desde)
          .order("detectado_em", { ascending: false })
          .limit(50);
        q = porCliente ? q.eq("cliente_id", att.cliente_id) : q.eq("contact_id", convData.contact_id);
        const { data: recentes } = await q;
        const atendimentos = new Set((recentes ?? []).map((r: any) => r.attendance_id));

        if (ehRecorrente(atendimentos.size)) {
          const pausa = new Date(Date.now() - RECORRENCIA_PAUSA_DIAS * 86400000).toISOString();
          const { count: jaAvisado, error: pausaErr } = await supabase
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("tenant_id", convData.tenant_id)
            .eq("type", "churn_alert")
            .eq("metadata->>dedupe_key", chave)
            .gte("created_at", pausa);

          // Na duvida, nao avisa: sem conseguir ler a pausa, avisaria a cada ocorrencia.
          if (pausaErr) console.error("[churn-alert] recorrencia: falha ao ler pausa:", pausaErr.message);
          if (!pausaErr && !jaAvisado) {
            const contact: any = (convData as any).whatsapp_contacts || {};
            const contactName = contact.name || contact.phone_number || "Cliente";
            const vistos = new Set<string>();
            const linhas = (recentes ?? []).filter((r: any) => !vistos.has(r.attendance_id) && vistos.add(r.attendance_id)).slice(0, 5)
              .map((r: any) => `• ${new Date(r.detectado_em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} (${r.alvo === "produto" ? "sistema" : "atendimento"}): "${String(r.trecho).substring(0, 120)}"`);
            await notifyEvent(
              supabase,
              convData.tenant_id,
              "churn_alert",
              chave,
              `🔁 Insatisfação recorrente: ${contactName}`,
              `Cliente: ${contactName} (${contact.phone_number || ""})\n${atendimentos.size} atendimentos com o cliente insatisfeito nos últimos ${RECORRENCIA_JANELA_DIAS} dias:\n${linhas.join("\n")}\nAbra o DoctorSaaS para ver a conversa.`,
              { source: "irritacao_recorrente", conversation_id: conversationId, cliente_id: att?.cliente_id ?? null, contact_id: convData.contact_id, contact_name: contactName, atendimentos: atendimentos.size },
              `/whatsapp?conversation=${conversationId}`,
            );
            console.log(`[churn-alert] recorrencia ${chave}: ${atendimentos.size} atendimentos`);
          }
        }
      } catch (recErr: any) {
        console.error("[churn-alert] recorrencia falhou:", recErr?.message || recErr);
      }
    }

    return new Response(JSON.stringify({ success: true, analysis }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[analyze-sentiment] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
