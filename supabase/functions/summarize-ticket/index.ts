import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getAIConfig, callAI } from "../_shared/ai-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Nao autenticado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ticketId, type } = await req.json();
    if (!ticketId || !type) {
      return new Response(JSON.stringify({ error: "ticketId e type obrigatorios" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: ticket, error: ticketErr } = await supabase
      .from("support_tickets")
      .select(`
        id, tenant_id, ticket_code, assunto, descricao, status,
        aberto_em, concluido_em, observacao_agente, prioridade,
        clientes:cliente_id(nome_fantasia),
        produtos:produto_id(nome),
        service_categories:category_id(nome),
        service_subcategories:subcategory_id(nome),
        service_types:service_type_id(nome)
      `)
      .eq("id", ticketId)
      .single();

    if (ticketErr || !ticket) {
      return new Response(JSON.stringify({ error: "Ticket nao encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Tenant check: usuário deve pertencer ao tenant do ticket (ou ser super admin)
    const { data: profile } = await supabase
      .from("profiles")
      .select("tenant_id, is_super_admin")
      .eq("user_id", user.id)
      .single();

    if (!profile || (!profile.is_super_admin && profile.tenant_id !== ticket.tenant_id)) {
      return new Response(JSON.stringify({ error: "Sem permissao para este ticket" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiConfig = await getAIConfig(ticket.tenant_id, supabase);
    if (!aiConfig) {
      return new Response(JSON.stringify({ error: "IA nao configurada para este tenant" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: events } = await supabase
      .from("support_ticket_events")
      .select("event_type, content, old_value, new_value, created_at")
      .eq("ticket_id", ticketId)
      .order("created_at", { ascending: true })
      .limit(100);

    const { data: attendances } = await supabase
      .from("support_attendances")
      .select("attendance_code, ai_summary, ai_problem, ai_solution, opened_at, closed_at, participant_type, participant_label")
      .eq("ticket_id", ticketId)
      .order("opened_at", { ascending: true });

    const clienteNome = (ticket as any).clientes?.nome_fantasia ?? "N/A";
    const produtoNome = (ticket as any).produtos?.nome ?? "N/A";
    const categoriaNome = (ticket as any).service_categories?.nome ?? "";
    const subcategoriaNome = (ticket as any).service_subcategories?.nome ?? "";
    const tipoServicoNome = (ticket as any).service_types?.nome ?? "";

    let ticketContext = `TICKET: ${ticket.ticket_code}\n`;
    ticketContext += `Cliente: ${clienteNome}\n`;
    ticketContext += `Produto: ${produtoNome}\n`;
    if (categoriaNome) ticketContext += `Classificacao: ${categoriaNome}`;
    if (subcategoriaNome) ticketContext += ` > ${subcategoriaNome}`;
    if (tipoServicoNome) ticketContext += ` > ${tipoServicoNome}`;
    ticketContext += "\n";
    ticketContext += `Assunto: ${ticket.assunto ?? "N/A"}\n`;
    if (ticket.descricao) ticketContext += `Descricao: ${ticket.descricao}\n`;
    ticketContext += `Prioridade: ${ticket.prioridade ?? "media"}\n`;
    ticketContext += `Status: ${ticket.status}\n`;
    ticketContext += `Aberto em: ${ticket.aberto_em}\n`;
    if (ticket.concluido_em) ticketContext += `Concluido em: ${ticket.concluido_em}\n`;
    if (ticket.observacao_agente) ticketContext += `Observacao do agente: ${ticket.observacao_agente}\n`;

    let eventsText = "";
    if (events && events.length > 0) {
      eventsText = "\n--- OCORRENCIAS ---\n";
      for (const evt of events) {
        const dt = new Date(evt.created_at).toLocaleString("pt-BR");
        if (evt.event_type === "comment") {
          eventsText += `[${dt}] Comentario: ${evt.content}\n`;
        } else if (evt.event_type === "status_change") {
          eventsText += `[${dt}] Status: ${evt.old_value} -> ${evt.new_value}\n`;
        } else if (evt.event_type === "ai_summary") {
          eventsText += `[${dt}] Resumo IA de conversa: ${(evt.new_value ?? "").substring(0, 200)}\n`;
        } else {
          eventsText += `[${dt}] ${evt.content ?? evt.event_type}: ${evt.old_value ?? ""} -> ${evt.new_value ?? ""}\n`;
        }
      }
    }

    let attendancesText = "";
    if (attendances && attendances.length > 0) {
      attendancesText = "\n--- CONVERSAS VINCULADAS ---\n";
      for (const att of attendances) {
        const tipo = att.participant_type === "third_party" ? ` (Terceiro: ${att.participant_label ?? ""})` : "";
        attendancesText += `\nConversa ${att.attendance_code}${tipo}:\n`;
        if (att.ai_summary) attendancesText += `  Resumo: ${att.ai_summary}\n`;
        if (att.ai_problem) attendancesText += `  Problema: ${att.ai_problem}\n`;
        if (att.ai_solution) attendancesText += `  Solucao: ${att.ai_solution}\n`;
      }
    }

    const isPartial = type === "partial";
    const promptType = isPartial
      ? "Gere um RESUMO PARCIAL do andamento deste ticket de suporte. O ticket ainda esta em aberto. Foque no que ja foi feito, pendencias e proximos passos."
      : "Gere um RESUMO CONCLUSIVO deste ticket de suporte. O ticket foi concluido. Foque no problema original, acoes tomadas, solucao final e resultado.";

    const prompt = `${promptType}\n\n${ticketContext}${eventsText}${attendancesText}\n\nRetorne o resumo em texto corrido, maximo 200 palavras, em portugues. Seja objetivo e profissional.`;

    console.log(`[summarize-ticket] ticketId=${ticketId}, type=${type}, events=${events?.length ?? 0}, attendances=${attendances?.length ?? 0}`);

    const result = await callAI(
      aiConfig,
      [
        { role: "system", content: "Voce e um analista de suporte tecnico. Gere resumos concisos e objetivos em portugues." },
        { role: "user", content: prompt },
      ],
      undefined,
      { maxTokens: 2000 }
    );

    const resumo = (result.content ?? "").trim();
    const field = isPartial ? "resumo_parcial" : "resumo_conclusivo";

    const { error: updateErr } = await supabase
      .from("support_tickets")
      .update({ [field]: resumo, atualizado_em: new Date().toISOString() })
      .eq("id", ticketId);

    if (updateErr) {
      return new Response(JSON.stringify({ error: "Erro ao salvar: " + updateErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase.from("support_ticket_events").insert({
      tenant_id: ticket.tenant_id,
      ticket_id: ticketId,
      user_id: user.id,
      event_type: "ai_summary",
      content: isPartial ? "Resumo parcial gerado pela IA" : "Resumo conclusivo gerado pela IA",
      new_value: resumo,
    });

    try {
      await supabase.from("ai_usage_log").insert({
        tenant_id: ticket.tenant_id,
        function_name: "summarize-ticket",
        model: aiConfig.model,
        provider: aiConfig.provider,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        estimated_cost_usd: result.usage.estimatedCostUsd,
      });
    } catch (e) {
      console.warn("[summarize-ticket] Erro ao registrar uso IA:", e);
    }

    console.log(`[summarize-ticket] Sucesso: ${field}, ${resumo.length} chars`);

    return new Response(JSON.stringify({ success: true, field, resumo }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[summarize-ticket] Erro:", err);
    return new Response(JSON.stringify({ error: (err as Error).message ?? "Erro interno" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
