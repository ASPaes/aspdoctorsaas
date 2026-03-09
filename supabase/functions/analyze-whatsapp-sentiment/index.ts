import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { conversationId } = await req.json();

    if (!conversationId) {
      return new Response(
        JSON.stringify({ success: false, error: 'conversationId is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[analyze-sentiment] Analyzing: ${conversationId}`);

    const { data: messages, error: messagesError } = await supabase
      .from('whatsapp_messages')
      .select('content, timestamp')
      .eq('conversation_id', conversationId)
      .eq('is_from_me', false)
      .order('timestamp', { ascending: false })
      .limit(10);

    if (messagesError) {
      console.error('[analyze-sentiment] Error fetching messages:', messagesError);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to fetch messages' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!messages || messages.length < 3) {
      return new Response(
        JSON.stringify({ success: false, message: 'Mínimo 3 mensagens necessário para análise', messagesFound: messages?.length || 0 }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: conversation } = await supabase
      .from('whatsapp_conversations')
      .select('id, contact_id, whatsapp_contacts(id, name, phone_number)')
      .eq('id', conversationId)
      .single();

    if (!conversation) {
      return new Response(
        JSON.stringify({ success: false, error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orderedMessages = [...messages].reverse();
    const messagesText = orderedMessages
      .map((msg, index) => `${index + 1}. [${new Date(msg.timestamp).toLocaleString('pt-BR')}]: "${msg.content}"`)
      .join('\n');

    const prompt = `Analise o sentimento das últimas mensagens deste cliente de WhatsApp e avalie se é necessário abrir um ticket de Customer Success (CS).

**Mensagens (mais antigas para mais recentes):**
${messagesText}

**Critérios de Análise de Sentimento:**
- **positive**: Cliente satisfeito, agradecido, animado, elogios
- **neutral**: Tom profissional, dúvidas técnicas, informações
- **negative**: Frustrado, insatisfeito, reclamando, impaciente

**Critérios para abertura de Ticket CS (needs_cs_ticket = true):**
- Cliente demonstra insatisfação persistente ou crescente
- Menção a cancelamento, troca de fornecedor, ou saída
- Reclamações sobre qualidade, preço ou atendimento
- Pedidos não atendidos repetidamente
- Tom agressivo ou ameaçador
- Palavras-chave: "cancelar", "trocar", "insatisfeito", "péssimo", "nunca mais", "concorrente", "vou sair"
- Cliente expressando frustração com prazos ou entregas

Se o sentimento for positivo, needs_cs_ticket geralmente é false, a menos que haja um pedido importante não atendido.

Analise o contexto geral e determine o sentimento predominante e se um ticket CS é necessário.`;

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        tools: [{
          type: "function",
          function: {
            name: "analyze_sentiment",
            description: "Analisa o sentimento das mensagens do cliente e avalia necessidade de ticket CS",
            parameters: {
              type: "object",
              properties: {
                sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
                confidence: { type: "number", description: "Score de confiança entre 0.00 e 1.00" },
                summary: { type: "string", description: "Resumo curto do sentimento (máx 100 caracteres)" },
                keywords: { type: "array", items: { type: "string" }, description: "Palavras-chave do sentimento" },
                needs_cs_ticket: { type: "boolean", description: "Se é necessário abrir um ticket de Customer Success" },
                cs_ticket_reason: { type: "string", description: "Motivo para abertura do ticket CS (máx 200 caracteres). Obrigatório se needs_cs_ticket=true" }
              },
              required: ["sentiment", "confidence", "summary", "needs_cs_ticket"],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: "function", function: { name: "analyze_sentiment" } }
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit excedido' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ success: false, error: 'Créditos insuficientes' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ success: false, error: 'AI analysis failed' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid AI response' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const result = JSON.parse(toolCall.function.arguments);

    if (!['positive', 'neutral', 'negative'].includes(result.sentiment)) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid sentiment value' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Get tenant_id from conversation
    const { data: convData } = await supabase
      .from('whatsapp_conversations')
      .select('tenant_id')
      .eq('id', conversationId)
      .single();

    const { data: analysis, error: upsertError } = await supabase
      .from('whatsapp_sentiment_analysis')
      .upsert({
        conversation_id: conversationId,
        contact_id: conversation.contact_id,
        tenant_id: convData?.tenant_id,
        sentiment: result.sentiment,
        confidence: result.confidence,
        summary: result.summary?.substring(0, 100),
        keywords: result.keywords || [],
        needs_cs_ticket: result.needs_cs_ticket || false,
        cs_ticket_reason: result.needs_cs_ticket ? (result.cs_ticket_reason?.substring(0, 200) || null) : null,
      }, { onConflict: 'conversation_id' })
      .select()
      .single();

    if (upsertError) {
      console.error('[analyze-sentiment] Error saving:', upsertError);
      return new Response(JSON.stringify({ success: false, error: 'Failed to save analysis' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log(`[analyze-sentiment] Success: ${analysis.id}, needs_cs_ticket: ${result.needs_cs_ticket}`);

    return new Response(
      JSON.stringify({ success: true, analysis }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[analyze-sentiment] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
