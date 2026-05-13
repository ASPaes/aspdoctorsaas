import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets, InstanceSecrets } from '../_shared/providers/index.ts';

const LOG = '[sync-whatsapp-groups]';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SyncedGroup {
  jid: string;
  name: string;
  pictureUrl?: string | null;
  participantCount?: number | null;
  participants?: { phone: string; name: string | null; admin: boolean; isLid?: boolean }[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchEvolutionGroups(
  secrets: InstanceSecrets,
  identifier: string,
  providerType: string,
): Promise<SyncedGroup[]> {
  const baseUrl = (secrets.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
  const headers: Record<string, string> = {};
  if (providerType === 'cloud') {
    headers['Authorization'] = `Bearer ${secrets.api_key || ''}`;
  } else {
    headers['apikey'] = secrets.api_key || '';
  }

  const url = `${baseUrl}/group/fetchAllGroups/${identifier}?getParticipants=true`;
  console.log(`${LOG} Evolution GET ${url}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Evolution fetchAllGroups error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data?.groups ?? []);
  return arr
    .map((g: any) => ({
      jid: g.id || g.jid,
      name: g.subject || g.name || '',
      pictureUrl: g.profilePictureUrl ?? null,
      participantCount: g.size ?? null,
      participants: (g.participants || []).map((p: any) => {
        // Evolution retorna id como: "5547999@s.whatsapp.net", "5547999:42@s.whatsapp.net", ou "267542@lid"
        const rawId = p.id || p.jid || '';
        const isLid = rawId.includes('@lid') || (!rawId.includes('@s.whatsapp.net') && !rawId.includes('@g.us'));
        let phone = rawId.replace('@s.whatsapp.net', '').replace('@lid', '').replace('@g.us', '').replace(/:\d+$/, '');
        return {
          phone,
          name: p.name || p.pushName || p.notify || null,
          admin: p.admin === 'admin' || p.admin === 'superadmin' || p.isAdmin === true || p.isSuperAdmin === true,
          isLid,
        };
      }),
    }))
    .filter((g: SyncedGroup) => !!g.jid);
}

async function fetchZapiGroups(secrets: InstanceSecrets): Promise<SyncedGroup[]> {
  const url = `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}/groups`;
  const headers: Record<string, string> = {};
  if (secrets.zapi_client_token) headers['Client-Token'] = secrets.zapi_client_token;

  console.log(`${LOG} Z-API GET ${url}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Z-API groups error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const arr = Array.isArray(data) ? data : (data?.groups ?? []);
  return arr
    .map((g: any) => {
      let jid = g.phone || g.id || g.chatId || '';
      if (jid && !String(jid).includes('@')) jid = `${jid}@g.us`;
      return {
        jid,
        name: g.name || g.subject || '',
        pictureUrl: g.image ?? null,
        participantCount: Array.isArray(g.participants) ? g.participants.length : (g.size ?? null),
        participants: (g.participants || []).map((p: any) => ({
          phone: (p.phone || p.id || '').replace(/\D/g, ''),
          name: p.name || p.displayName || null,
          admin: p.admin === true || p.isAdmin === true,
        })),
      };
    })
    .filter((g: SyncedGroup) => !!g.jid);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { instance_id } = await req.json();
    if (!instance_id) return jsonResponse({ error: 'instance_id obrigatório' }, 400);

    console.log(`${LOG} Sync requested for instance ${instance_id}`);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: instance, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, tenant_id, instance_name, provider_type, instance_id_external')
      .eq('id', instance_id)
      .single();

    if (instErr || !instance) {
      return jsonResponse({ error: 'Instância não encontrada' }, 404);
    }

    if (instance.provider_type === 'meta_cloud') {
      return jsonResponse({
        groups: [],
        synced: 0,
        unsupported: true,
        message: 'Meta Cloud API não suporta grupos WhatsApp',
      });
    }

    const secrets = await getInstanceSecrets(supabase, instance_id);

    let groups: SyncedGroup[] = [];
    if (instance.provider_type === 'zapi') {
      groups = await fetchZapiGroups(secrets);
    } else {
      const identifier =
        instance.provider_type === 'cloud' && instance.instance_id_external
          ? instance.instance_id_external
          : instance.instance_name;
      groups = await fetchEvolutionGroups(secrets, identifier, instance.provider_type);
    }

    console.log(`${LOG} Fetched ${groups.length} groups from provider`);

    const nowIso = new Date().toISOString();
    if (groups.length > 0) {
      const rows = groups.map((g) => ({
        tenant_id: instance.tenant_id,
        instance_id: instance.id,
        group_jid: g.jid,
        group_name: g.name,
        group_picture_url: g.pictureUrl ?? null,
        participant_count: g.participantCount ?? null,
        participants: g.participants || [],
        last_synced_at: nowIso,
        updated_at: nowIso,
      }));
      const { error: upErr } = await supabase
        .from('whatsapp_groups')
        .upsert(rows, { onConflict: 'tenant_id,instance_id,group_jid' });
      if (upErr) throw new Error(`upsert error: ${upErr.message}`);
    }

    // Disable groups no longer present in provider
    const presentJids = new Set(groups.map((g) => g.jid));
    const { data: existing, error: exErr } = await supabase
      .from('whatsapp_groups')
      .select('group_jid')
      .eq('tenant_id', instance.tenant_id)
      .eq('instance_id', instance.id);
    if (exErr) throw new Error(`select existing error: ${exErr.message}`);

    const toDisable = (existing ?? [])
      .map((r: any) => r.group_jid)
      .filter((jid: string) => !presentJids.has(jid));

    if (toDisable.length > 0) {
      const { error: disErr } = await supabase
        .from('whatsapp_groups')
        .update({ enabled: false, updated_at: nowIso })
        .eq('tenant_id', instance.tenant_id)
        .eq('instance_id', instance.id)
        .in('group_jid', toDisable);
      if (disErr) console.error(`${LOG} disable error:`, disErr.message);
    }

    return jsonResponse({
      groups: groups.map((g) => ({
        jid: g.jid,
        name: g.name,
        participantCount: g.participantCount ?? null,
      })),
      synced: groups.length,
      total: groups.length,
    });
  } catch (err: any) {
    console.error(`${LOG} error:`, err?.message || err);
    return jsonResponse({ error: err?.message || String(err) }, 500);
  }
});
