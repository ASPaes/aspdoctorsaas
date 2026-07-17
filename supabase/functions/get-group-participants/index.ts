import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json(401, { success: false, error: 'Unauthorized' });
    }
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    const user = userData?.user;
    if (authErr || !user) return json(401, { success: false, error: 'Unauthorized' });

    const { conversationId } = await req.json();
    if (!conversationId) return json(400, { success: false, error: 'conversationId é obrigatório' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: conversation, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('id, tenant_id, is_group, group_jid, instance_id')
      .eq('id', conversationId)
      .single();
    if (convErr || !conversation) return json(404, { success: false, error: 'Conversa não encontrada' });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, tenant_id, is_super_admin')
      .eq('user_id', user.id)
      .single();
    if (!profile) return json(403, { success: false, error: 'Perfil não encontrado' });
    if (!profile.is_super_admin && profile.tenant_id !== conversation.tenant_id) {
      return json(403, { success: false, error: 'Acesso negado' });
    }

    if (!conversation.is_group || !conversation.group_jid) {
      return json(400, { success: false, error: 'Conversa não é um grupo' });
    }
    if (!conversation.instance_id) {
      return json(400, { success: false, error: 'Conversa sem instância' });
    }

    const [instanceResult, secrets] = await Promise.all([
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id, phone_number')
        .eq('id', conversation.instance_id)
        .single(),
      getInstanceSecrets(supabase, conversation.instance_id),
    ]);
    if (instanceResult.error || !instanceResult.data) {
      return json(404, { success: false, error: 'Instância não encontrada' });
    }

    const instanceData = instanceResult.data as any;
    const providerType = instanceData.provider_type || 'self_hosted';
    const adapter = getAdapter(providerType);

    if (typeof adapter.getGroupParticipants !== 'function') {
      return json(400, { success: false, error: 'Provedor não suporta listar participantes' });
    }

    const roster = await adapter.getGroupParticipants(
      secrets, instanceData, conversation.group_jid,
    );

    return json(200, { success: true, providerType, ...roster });
  } catch (err) {
    console.error('[get-group-participants] Erro:', err);
    return json(500, { success: false, error: (err as any)?.message ?? 'Erro ao buscar participantes' });
  }
});
