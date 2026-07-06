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
  participants?: { phone: string; name: string | null; admin: boolean; isLid?: boolean; lid?: string | null }[];
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function fetchGroupParticipantsEvolution(
  secrets: InstanceSecrets,
  identifier: string,
  providerType: string,
  groupJid: string,
): Promise<{ phone: string; name: string | null; admin: boolean; isLid: boolean; lid: string | null }[]> {
  try {
    const baseUrl = (secrets.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
    const headers: Record<string, string> = {};
    if (providerType === 'cloud') {
      headers['Authorization'] = `Bearer ${secrets.api_key || ''}`;
    } else {
      headers['apikey'] = secrets.api_key || '';
    }

    const url = `${baseUrl}/group/findGroupInfos/${identifier}?groupJid=${encodeURIComponent(groupJid)}`;
    console.log(`${LOG} Fetching participants for group ${groupJid}`);
    const res = await fetch(url, { headers });

    if (!res.ok) {
      console.log(`${LOG} findGroupInfos returned ${res.status} for ${groupJid}`);
      return [];
    }

    const data = await res.json();
    const participants = data?.participants || [];

    return participants.map((p: any) => {
      const rawPhone = p.phoneNumber || p.id || '';
      const phone = rawPhone.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/@.*/, '').replace(/:\d+$/, '');
      const isRealPhone = rawPhone.includes('@s.whatsapp.net');
      const rawId = String(p.id || '');
      const lid = /@lid(:\d+)?$/.test(rawId) ? rawId.replace(/@lid(:\d+)?$/, '').replace(/:\d+$/, '') : null;

      return {
        phone,
        name: p.pushName || p.name || p.notify || null,
        admin: p.admin === 'admin' || p.admin === 'superadmin',
        isLid: !isRealPhone,
        lid,
      };
    });
  } catch (err) {
    console.error(`${LOG} fetchGroupParticipantsEvolution error for ${groupJid}:`, err);
    return [];
  }
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

  const url = `${baseUrl}/group/fetchAllGroups/${identifier}?getParticipants=false`;
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
      participants: [],
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
          lid: null,
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

    // Buscar participantes reais por grupo (Evolution only — usa endpoint que retorna phoneNumber)
    if (instance.provider_type !== 'zapi' && instance.provider_type !== 'meta_cloud') {
      const identifier = instance.provider_type === 'cloud' && instance.instance_id_external
        ? instance.instance_id_external
        : instance.instance_name;

      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        if (!g.jid) continue;
        // Delay de 500ms entre chamadas pra evitar rate limit da Evolution
        if (i > 0) await new Promise((r) => setTimeout(r, 500));
        const realParticipants = await fetchGroupParticipantsEvolution(
          secrets, identifier, instance.provider_type, g.jid
        );
        if (realParticipants.length > 0) {
          g.participants = realParticipants;
          g.participantCount = realParticipants.length;
        }
      }
      console.log(`${LOG} Fetched real participants for ${groups.length} groups`);

      // Resolver nomes: cruzar telefones com whatsapp_contacts e clientes
      const allPhones = new Set<string>();
      for (const g of groups) {
        for (const p of (g.participants || [])) {
          if (p.phone && !p.isLid) allPhones.add(p.phone);
        }
      }

      if (allPhones.size > 0) {
        const phonesArr = Array.from(allPhones);
        // Gerar variantes com/sem nono dígito (55DD + 8 dígitos ↔ 55DD9 + 8 dígitos)
        const allVariants: string[] = [];
        const variantToOriginal = new Map<string, string>();
        for (const ph of phonesArr) {
          allVariants.push(ph);
          variantToOriginal.set(ph, ph);
          if (ph.startsWith('55') && ph.length === 12) {
            const with9 = ph.slice(0, 4) + '9' + ph.slice(4);
            allVariants.push(with9);
            variantToOriginal.set(with9, ph);
          }
          if (ph.startsWith('55') && ph.length === 13) {
            const without9 = ph.slice(0, 4) + ph.slice(5);
            allVariants.push(without9);
            variantToOriginal.set(without9, ph);
          }
        }

        const nameMap = new Map<string, string>();

        // Buscar nomes de contatos WhatsApp (chunks de 100 pra evitar limite PostgREST)
        for (let i = 0; i < allVariants.length; i += 100) {
          const chunk = allVariants.slice(i, i + 100);
          const { data: contacts } = await supabase
            .from('whatsapp_contacts')
            .select('phone_number, name')
            .eq('tenant_id', instance.tenant_id)
            .eq('is_group', false)
            .in('phone_number', chunk);

          for (const c of (contacts || [])) {
            if (c.name && c.name !== c.phone_number) {
              const original = variantToOriginal.get(c.phone_number) || c.phone_number;
              if (!nameMap.has(original)) nameMap.set(original, c.name);
            }
          }
        }

        // Buscar nomes de clientes pelo telefone
        const { data: clientes } = await supabase
          .from('clientes')
          .select('telefone_whatsapp, telefone_whatsapp_contato, nome_fantasia, razao_social')
          .eq('tenant_id', instance.tenant_id)
          .eq('cancelado', false);

        for (const cl of (clientes || [])) {
          const nome = cl.nome_fantasia || cl.razao_social;
          if (!nome) continue;
          for (const tel of [cl.telefone_whatsapp, cl.telefone_whatsapp_contato]) {
            if (!tel) continue;
            const original = variantToOriginal.get(tel);
            if (original && !nameMap.has(original)) {
              nameMap.set(original, nome);
            }
          }
        }

        // Aplicar nomes resolvidos
        if (nameMap.size > 0) {
          for (const g of groups) {
            for (const p of (g.participants || [])) {
              if (!p.name && p.phone && nameMap.has(p.phone)) {
                p.name = nameMap.get(p.phone)!;
              }
            }
          }
          console.log(`${LOG} Resolved ${nameMap.size} participant names from contacts/clientes`);
        }
      }
    }

    const nowIso = new Date().toISOString();
    if (groups.length > 0) {
      // Separar: grupos COM participantes resolvidos vs SEM (pra não sobrescrever dados existentes com [])
      const rowsWithParticipants = groups.filter((g) => g.participants && g.participants.length > 0);
      const rowsWithout = groups.filter((g) => !g.participants || g.participants.length === 0);

      if (rowsWithParticipants.length > 0) {
        const fullRows = rowsWithParticipants.map((g) => ({
          tenant_id: instance.tenant_id,
          instance_id: instance.id,
          group_jid: g.jid,
          group_name: g.name,
          group_picture_url: g.pictureUrl ?? null,
          participant_count: g.participantCount ?? null,
          participants: g.participants,
          last_synced_at: nowIso,
          updated_at: nowIso,
        }));
        const { error } = await supabase
          .from('whatsapp_groups')
          .upsert(fullRows, { onConflict: 'tenant_id,instance_id,group_jid' });
        if (error) console.error(`${LOG} upsert (with participants) error:`, error.message);
      }

      if (rowsWithout.length > 0) {
        // Sem participants — upsert só metadata, preserva participants existentes
        const metaRows = rowsWithout.map((g) => ({
          tenant_id: instance.tenant_id,
          instance_id: instance.id,
          group_jid: g.jid,
          group_name: g.name,
          group_picture_url: g.pictureUrl ?? null,
          participant_count: g.participantCount ?? null,
          last_synced_at: nowIso,
          updated_at: nowIso,
        }));
        const { error } = await supabase
          .from('whatsapp_groups')
          .upsert(metaRows, { onConflict: 'tenant_id,instance_id,group_jid' });
        if (error) console.error(`${LOG} upsert (metadata only) error:`, error.message);
      }
    }

    // Two-strike disable: nunca desabilitar grupos com base em UMA resposta do provider.
    // - Fetch vazio => provavelmente falha da Evolution: não tocar em nada.
    // - Grupo presente => limpa missing_since. NUNCA tocar em enabled de grupo presente.
    // - Grupo ausente pela 1ª vez => marca missing_since, mantém enabled.
    // - Grupo ausente de novo após 24h+ => aí sim enabled=false.
    if (groups.length === 0) {
      console.warn(`${LOG} Provider retornou 0 grupos — pulando etapa de disable (possível falha/instabilidade do provider)`);
    } else {
      const presentJids = new Set(groups.map((g) => g.jid));
      const { data: existing, error: exErr } = await supabase
        .from('whatsapp_groups')
        .select('group_jid, missing_since, enabled')
        .eq('tenant_id', instance.tenant_id)
        .eq('instance_id', instance.id);
      if (exErr) throw new Error(`select existing error: ${exErr.message}`);

      const rows = existing ?? [];
      const presentToClear = rows
        .filter((r: any) => presentJids.has(r.group_jid) && r.missing_since !== null)
        .map((r: any) => r.group_jid);
      const absentRows = rows.filter((r: any) => !presentJids.has(r.group_jid));
      const firstStrike = absentRows
        .filter((r: any) => r.missing_since === null)
        .map((r: any) => r.group_jid);
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      const secondStrike = absentRows
        .filter((r: any) => r.missing_since !== null && new Date(r.missing_since).getTime() < cutoff && r.enabled)
        .map((r: any) => r.group_jid);

      if (presentToClear.length > 0) {
        const { error } = await supabase.from('whatsapp_groups')
          .update({ missing_since: null, updated_at: nowIso })
          .eq('tenant_id', instance.tenant_id).eq('instance_id', instance.id)
          .in('group_jid', presentToClear);
        if (error) console.error(`${LOG} clear missing_since error:`, error.message);
      }

      if (firstStrike.length > 0) {
        const { error } = await supabase.from('whatsapp_groups')
          .update({ missing_since: nowIso, updated_at: nowIso })
          .eq('tenant_id', instance.tenant_id).eq('instance_id', instance.id)
          .in('group_jid', firstStrike);
        if (error) console.error(`${LOG} set missing_since error:`, error.message);
        console.log(`${LOG} ${firstStrike.length} grupo(s) ausente(s) marcados com missing_since (1º strike, enabled intacto)`);
      }

      if (secondStrike.length > 0) {
        const { error } = await supabase.from('whatsapp_groups')
          .update({ enabled: false, updated_at: nowIso })
          .eq('tenant_id', instance.tenant_id).eq('instance_id', instance.id)
          .in('group_jid', secondStrike);
        if (error) console.error(`${LOG} disable error:`, error.message);
        console.log(`${LOG} ${secondStrike.length} grupo(s) desabilitado(s) após 2º strike (ausentes por 24h+): ${secondStrike.join(', ')}`);
      }
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
