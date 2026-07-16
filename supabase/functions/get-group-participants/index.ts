import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { conversationId } = await req.json();
    if (!conversationId) {
      return new Response(JSON.stringify({ success: false, error: 'conversationId é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: conversation, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('id, is_group, group_jid, instance_id')
      .eq('id', conversationId)
      .single();

    if (convErr || !conversation) {
      return new Response(JSON.stringify({ success: false, error: 'Conversa não encontrada' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!conversation.is_group || !conversation.group_jid) {
      return new Response(JSON.stringify({ success: false, error: 'Conversa não é um grupo' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!conversation.instance_id) {
      return new Response(JSON.stringify({ success: false, error: 'Conversa sem instância' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const [instanceResult, secrets] = await Promise.all([
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
        .eq('id', conversation.instance_id)
        .single(),
      getInstanceSecrets(supabase, conversation.instance_id),
    ]);

    if (instanceResult.error || !instanceResult.data) {
      return new Response(JSON.stringify({ success: false, error: 'Instância não encontrada' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const instanceData = instanceResult.data as any;
    const adapter = getAdapter(instanceData.provider_type || 'self_hosted');

    if (typeof adapter.getGroupParticipants !== 'function') {
      return new Response(
        JSON.stringify({ success: false, error: 'Provedor não suporta listar participantes' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { count } = await adapter.getGroupParticipants(
      secrets, instanceData, conversation.group_jid
    );

    return new Response(JSON.stringify({ success: true, count }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[get-group-participants] Erro:', err);
    return new Response(JSON.stringify({ success: false, error: 'Erro ao buscar participantes' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
