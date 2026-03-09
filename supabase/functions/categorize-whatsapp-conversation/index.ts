import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const systemPrompt = `Você é um especialista em categorizar conversas de atendimento ao cliente via WhatsApp.

TÓPICOS PADRÃO (SEMPRE PREFERIR ESTES):

**Comercial:** vendas, cobranca, renovacao
**Suporte:** duvida_tecnica, duvida_produto, acesso
**Relacionamento:** feedback, cancelamento, onboarding
**Operacional:** agendamento, documentacao, atualizacao_cadastral
**Outros:** geral, spam

TAREFA:
Analise a conversa e retorne um JSON com:
{
  "primary_topic": "tópico principal da lista acima",
  "secondary_topics": ["tópico 2", "tópico 3"],
  "confidence": 0.95,
  "reasoning": "breve explicação",
  "custom_topic": null
}

REGRAS:
1. SEMPRE tente encaixar nos tópicos padrão primeiro
2. Use custom_topic apenas se a conversa for MUITO específica
3. Seja conservador: prefira "geral" a criar novo tópico
4. Retorne APENAS o JSON, sem markdown`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { conversationId } = await req.json();

    if (!conversationId) {
      return new Response(
        JSON.stringify({ error: 'conversationId é obrigatório' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'IA não configurada' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log(`[categorize] Categorizando: ${conversationId}`);

    const { data: messages, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('content, is_from_me, timestamp, message_type')
      .eq('conversation_id', conversationId)
      .order('timestamp', { ascending: true });

    if (msgError) throw msgError;

    const textMessages = messages?.filter(m => m.content && m.message_type === 'text').map(m => {
      const sender = m.is_from_me ? 'Atendente' : 'Cliente';
      return `${sender}: ${m.content}`;
    }) || [];

    if (textMessages.length === 0) {
      return new Response(
        JSON.stringify({ success: false, message: 'Sem mensagens de texto para categorizar' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const recentMessages = textMessages.slice(-50);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${lovableApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `CONVERSA:\n\n${recentMessages.join('\n')}` }
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: 'Rate limit excedido' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (response.status === 402) return new Response(JSON.stringify({ error: 'Créditos esgotados' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      throw new Error(`AI error: ${response.status}`);
    }

    const aiData = await response.json();
    const aiResponse = aiData.choices[0].message.content.trim();
    const cleanJson = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    let result;
    try { result = JSON.parse(cleanJson); } catch { throw new Error('Failed to parse AI response'); }

    const topics = [result.primary_topic, ...(result.secondary_topics || [])].filter(Boolean);
    if (result.custom_topic) topics.push(result.custom_topic);

    const { data: existingConv } = await supabase.from('whatsapp_conversations').select('metadata').eq('id', conversationId).single();
    const existingMetadata = existingConv?.metadata || {};

    const newMetadata = {
      ...(existingMetadata as object),
      topics,
      primary_topic: result.primary_topic,
      ai_confidence: result.confidence || 0.8,
      categorized_at: new Date().toISOString(),
      categorization_model: 'google/gemini-2.5-flash',
      ai_reasoning: result.reasoning,
      custom_topics: result.custom_topic ? [result.custom_topic] : []
    };

    const { error: updateError } = await supabase.from('whatsapp_conversations').update({ metadata: newMetadata }).eq('id', conversationId);
    if (updateError) throw updateError;

    console.log('[categorize] Success:', topics);

    return new Response(
      JSON.stringify({ success: true, metadata: newMetadata, message: 'Conversa categorizada com sucesso' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[categorize] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Erro desconhecido', success: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
