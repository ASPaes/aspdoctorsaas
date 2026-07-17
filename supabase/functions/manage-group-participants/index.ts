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

type Action = 'add' | 'remove' | 'promote' | 'demote';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  let auditPayload: Record<string, unknown> = {};
  let auditTenantId: string | null = null;
  let auditActor: string | null = null;
  let auditAction: string | null = null;
  const supabase = createClient(supabaseUrl, serviceKey);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json(401, { success: false, error: 'Unauthorized' });

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    const user = userData?.user;
    if (authErr || !user) return json(401, { success: false, error: 'Unauthorized' });
    auditActor = user.id;

    const body = await req.json().catch(() => ({}));
    const conversationId: string | undefined = body?.conversationId;
    const action: Action | undefined = body?.action;
    const participantId: string | undefined = body?.participantId;
    const phone: string | undefined = body?.phone;

    if (!conversationId || !action) {
      return json(400, { success: false, error: 'conversationId e action são obrigatórios' });
    }
    if (!['add', 'remove', 'promote', 'demote'].includes(action)) {
      return json(400, { success: false, error: 'action inválida' });
    }
    auditAction = action;

    // Profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, tenant_id, is_super_admin')
      .eq('user_id', user.id)
      .single();
    if (!profile) return json(403, { success: false, error: 'Perfil não encontrado' });

    // Conversation
    const { data: conversation, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('id, tenant_id, is_group, group_jid, instance_id')
      .eq('id', conversationId)
      .single();
    if (convErr || !conversation) return json(404, { success: false, error: 'Conversa não encontrada' });
    auditTenantId = conversation.tenant_id;

    if (!profile.is_super_admin && profile.tenant_id !== conversation.tenant_id) {
      return json(403, { success: false, error: 'Acesso negado' });
    }
    if (!conversation.is_group || !conversation.group_jid) {
      return json(400, { success: false, error: 'Conversa não é um grupo' });
    }
    if (!conversation.instance_id) return json(400, { success: false, error: 'Conversa sem instância' });

    // Role check (autoridade real — neutraliza tenants com rbac_enabled=false)
    const roleOk = profile.is_super_admin || ['admin', 'head'].includes(String(profile.role));
    if (!roleOk) return json(403, { success: false, error: 'Sem permissão' });

    // Permission check em AND
    const { data: perms } = await anonClient.rpc('get_my_permissions');
    const p = (perms ?? []).find((x: any) => x.resource_key === 'atendimento_grupo_participantes');
    const permOk = profile.is_super_admin || (
      action === 'add' ? p?.can_insert :
      action === 'remove' ? p?.can_delete :
      p?.can_update
    );
    if (!permOk) return json(403, { success: false, error: 'Sem permissão' });

    // Instance + adapter
    const { data: instanceData, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id, phone_number')
      .eq('id', conversation.instance_id)
      .single();
    if (instErr || !instanceData) return json(404, { success: false, error: 'Instância não encontrada' });

    const providerType = instanceData.provider_type || 'self_hosted';
    if (!['self_hosted', 'cloud'].includes(providerType)) {
      return json(400, { success: false, error: 'Provedor não suporta gestão de grupos' });
    }
    const adapter = getAdapter(providerType);
    if (typeof adapter.updateGroupParticipant !== 'function' || typeof adapter.getGroupParticipants !== 'function') {
      return json(400, { success: false, error: 'Provedor não suporta gestão de grupos' });
    }

    const secrets = await getInstanceSecrets(supabase, conversation.instance_id);

    // Roster ao vivo
    const roster = await adapter.getGroupParticipants(secrets, instanceData as any, conversation.group_jid);

    // Guardas
    if (!roster.selfIsAdmin) {
      return json(409, { success: false, error: 'A instância não é admin do grupo' });
    }
    if (['remove', 'demote'].includes(action) && !roster.selfResolved) {
      return json(409, { success: false, error: 'Não foi possível identificar a instância no grupo' });
    }

    let target: { id: string; phone: string | null; name: string | null; admin: string | null } | null = null;
    let jidToSend: string;

    if (action === 'add') {
      const cleanPhone = String(phone ?? '').replace(/\D/g, '');
      if (!cleanPhone) return json(400, { success: false, error: 'phone é obrigatório para add' });

      // Verificar existência no WhatsApp via edge function
      try {
        const checkRes = await fetch(`${supabaseUrl}/functions/v1/check-whatsapp-number`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify({ instanceId: conversation.instance_id, phone: cleanPhone }),
        });
        const checkData = await checkRes.json();
        if (!checkData?.exists) {
          return json(400, { success: false, error: 'Número não existe no WhatsApp' });
        }
        jidToSend = checkData.phone ?? cleanPhone;
      } catch (e) {
        return json(400, { success: false, error: 'Falha ao validar número: ' + (e as any)?.message });
      }
      target = { id: jidToSend, phone: jidToSend, name: null, admin: null };
    } else {
      if (!participantId) return json(400, { success: false, error: 'participantId é obrigatório' });
      const found = roster.participants.find((x: any) => x.id === participantId);
      if (!found) return json(404, { success: false, error: 'Participante não encontrado no grupo' });
      target = found;

      if (participantId === roster.selfId) {
        return json(403, { success: false, error: 'Não é possível operar sobre a própria instância' });
      }
      if (action === 'demote' && found.admin === 'superadmin') {
        return json(403, { success: false, error: 'Não é possível rebaixar o dono do grupo' });
      }
      jidToSend = found.id;
    }

    // Executar
    let executeErr: any = null;
    let result: { jid: string; status: string; ok: boolean } | null = null;
    let raw: unknown = null;
    try {
      const exec = await adapter.updateGroupParticipant(
        secrets, instanceData as any, conversation.group_jid, action, [jidToSend],
      );
      raw = exec.raw;
      result = exec.results[0] ?? { jid: jidToSend, status: 'unknown', ok: false };
    } catch (e) {
      executeErr = e;
    }

    auditPayload = {
      conversation_id: conversation.id,
      group_jid: conversation.group_jid,
      instance_id: conversation.instance_id,
      target_id: target?.id ?? null,
      target_phone: target?.phone ?? phone ?? null,
      target_name: target?.name ?? null,
      result_status: result?.status ?? null,
      ok: result?.ok ?? false,
      evolution_raw: raw ?? null,
      error: executeErr ? String((executeErr as any)?.message ?? executeErr) : null,
    };

    if (executeErr) {
      return json(502, { success: false, error: (executeErr as any)?.message ?? 'Falha ao executar' });
    }
    if (!result?.ok) {
      return json(200, {
        success: true, ok: false, status: result?.status ?? 'unknown',
        message: `A Evolution retornou status ${result?.status ?? 'desconhecido'} para esta operação.`,
      });
    }
    return json(200, { success: true, ok: true, status: '200', message: 'Operação concluída' });
  } catch (err) {
    console.error('[manage-group-participants] Erro:', err);
    auditPayload = { ...auditPayload, fatal_error: (err as any)?.message ?? String(err) };
    return json(500, { success: false, error: (err as any)?.message ?? 'Erro interno' });
  } finally {
    if (auditAction) {
      try {
        await supabase.from('audit_events').insert({
          tenant_id: auditTenantId,
          actor_user_id: auditActor,
          event_type: `whatsapp_group_participant_${auditAction}`,
          metadata: auditPayload as any,
        });
      } catch (e) {
        console.error('[manage-group-participants] audit insert failed:', e);
      }
    }
  }
});
