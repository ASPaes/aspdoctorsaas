import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

async function getSecrets(supabase: any, instanceId: string) {
  const out: Record<string, string> = {};
  // Vault refs
  const { data: refs } = await supabase
    .from('whatsapp_instance_vault_refs')
    .select('secret_name, vault_secret_id')
    .eq('instance_id', instanceId);
  if (refs?.length) {
    const { data: vaultSecrets } = await supabase
      .schema('vault')
      .from('decrypted_secrets')
      .select('id, decrypted_secret')
      .in('id', refs.map((r: any) => r.vault_secret_id));
    const map = new Map((vaultSecrets ?? []).map((s: any) => [s.id, s.decrypted_secret]));
    for (const r of refs) {
      const v = map.get(r.vault_secret_id);
      if (v) out[r.secret_name] = v as string;
    }
  }
  // Plaintext table fallback
  const { data: tbl } = await supabase
    .from('whatsapp_instance_secrets')
    .select('api_url, api_key, zapi_token, zapi_instance_id, zapi_client_token')
    .eq('instance_id', instanceId)
    .maybeSingle();
  if (tbl) {
    for (const [k, v] of Object.entries(tbl)) {
      if (v && !out[k]) out[k] = v as string;
    }
  }
  return out;
}

async function logoutProvider(providerType: string, secrets: Record<string, string>, instance: any): Promise<{ ok: boolean; error?: string }> {
  try {
    if (providerType === 'self_hosted' || providerType === 'cloud') {
      const base = (secrets.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
      const id = providerType === 'cloud' && instance.instance_id_external ? instance.instance_id_external : instance.instance_name;
      if (!base || !secrets.api_key) return { ok: true };
      const res = await fetch(`${base}/instance/logout/${id}`, {
        method: 'DELETE',
        headers: { apikey: secrets.api_key },
      });
      console.log(`[deactivate] Evolution logout ${res.status}`);
      return { ok: true };
    }
    if (providerType === 'zapi') {
      const id = secrets.zapi_instance_id;
      const tok = secrets.zapi_token;
      if (!id || !tok) return { ok: true };
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secrets.zapi_client_token) headers['Client-Token'] = secrets.zapi_client_token;
      const res = await fetch(`https://api.z-api.io/instances/${id}/token/${tok}/disconnect`, {
        method: 'GET',
        headers,
      });
      console.log(`[deactivate] Z-API disconnect ${res.status}`);
      return { ok: true };
    }
    // Meta Cloud não tem endpoint de logout; só remover credenciais
    return { ok: true };
  } catch (err) {
    console.error('[deactivate] provider logout error', err);
    return { ok: false, error: String(err) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json(401, { error: 'Unauthorized' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  const supabase = createClient(supabaseUrl, serviceKey);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !user) return json(401, { error: 'Unauthorized' });

  try {
    const { instance_id } = await req.json();
    if (!instance_id) return json(400, { error: 'instance_id obrigatório' });

    const { data: instance, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, tenant_id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
      .eq('id', instance_id)
      .maybeSingle();
    if (instErr || !instance) return json(404, { error: 'instance not found' });

    // Authorization: super_admin OR admin/head do mesmo tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role, is_super_admin')
      .eq('user_id', user.id)
      .maybeSingle();

    const isSuperAdmin = profile?.is_super_admin === true;
    const sameTenant = profile?.tenant_id === instance.tenant_id;
    const isAdminOrHead = sameTenant && ['admin', 'head'].includes(profile?.role || '');
    if (!isSuperAdmin && !isAdminOrHead) {
      return json(403, { error: 'Apenas administradores podem desativar instâncias.' });
    }

    // 1) Pega segredos
    const secrets = await getSecrets(supabase, instance_id);

    // 2) Logout no provedor
    const logoutResult = await logoutProvider(instance.provider_type, secrets, instance);

    // 3) Apaga credenciais (Vault + tabela em texto)
    const { data: refs } = await supabase
      .from('whatsapp_instance_vault_refs')
      .select('vault_secret_id')
      .eq('instance_id', instance_id);

    if (refs?.length) {
      // Remove refs primeiro
      await supabase.from('whatsapp_instance_vault_refs').delete().eq('instance_id', instance_id);
      // Apaga segredos no Vault
      for (const r of refs) {
        try {
          await supabase.schema('vault').from('secrets').delete().eq('id', r.vault_secret_id);
        } catch (e) {
          console.warn('[deactivate] vault delete failed', e);
        }
      }
    }
    await supabase.from('whatsapp_instance_secrets').delete().eq('instance_id', instance_id);

    // 4) Marca como inativa e desconectada
    const { error: updErr } = await supabase
      .from('whatsapp_instances')
      .update({ is_active: false, status: 'disconnected', updated_at: new Date().toISOString() })
      .eq('id', instance_id);
    if (updErr) throw updErr;

    return json(200, { ok: true, logout: logoutResult });
  } catch (err) {
    console.error('[deactivate-whatsapp-instance]', err);
    return json(200, { success: false, error: String(err) });
  }
});
