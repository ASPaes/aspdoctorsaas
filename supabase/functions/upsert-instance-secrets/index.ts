import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SENSITIVE_FIELDS = [
  'api_key', 'api_url',
  'zapi_token', 'zapi_instance_id', 'zapi_client_token',
  'meta_access_token', 'meta_app_secret', 'meta_verify_token',
];

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // ── Defense in depth: validate JWT manually even if verify_jwt is on ──
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(401, { error: 'Unauthorized: missing bearer token' });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

  // Service-role client for trusted DB ops
  const supabase = createClient(supabaseUrl, serviceKey);

  // Anon client just to verify the token belongs to a real user
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) {
    return json(401, { error: 'Unauthorized: invalid token' });
  }

  try {
    const body = await req.json();
    const { instance_id, ...fields } = body;
    if (!instance_id) {
      return json(400, { error: 'instance_id obrigatório' });
    }

    // ── Authorization: caller must be admin/head of the instance's tenant ──
    // (super_admins also pass)
    const { data: instance, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, tenant_id')
      .eq('id', instance_id)
      .maybeSingle();

    if (instErr || !instance) {
      return json(404, { error: 'instance not found' });
    }

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('tenant_id, role, is_super_admin, access_status, status')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profErr || !profile) {
      return json(403, { error: 'profile not found' });
    }

    const isSuperAdmin = profile.is_super_admin === true;
    const sameTenant = profile.tenant_id === instance.tenant_id;
    const isAdminOrHead =
      sameTenant && ['admin', 'head'].includes(profile.role || '');
    const isActive =
      ['active', 'ativo'].includes(profile.access_status || '') &&
      ['ativo', 'active'].includes(profile.status || 'ativo');

    if (!isSuperAdmin && (!isAdminOrHead || !isActive)) {
      console.warn(
        `[upsert-instance-secrets] Forbidden: user=${user.id} role=${profile.role} ` +
          `caller_tenant=${profile.tenant_id} instance_tenant=${instance.tenant_id}`,
      );
      return json(403, {
        error:
          'Apenas administradores do tenant podem alterar credenciais da instância.',
      });
    }

    // ── Original upsert logic ──
    for (const field of SENSITIVE_FIELDS) {
      const val = fields[field];
      if (val === undefined || val === null || val === '') continue;

      const secretName = `instance_${instance_id}_${field}`;

      const { data: existing } = await supabase
        .from('whatsapp_instance_vault_refs')
        .select('vault_secret_id')
        .eq('instance_id', instance_id)
        .eq('secret_name', field)
        .maybeSingle();

      let vaultId: string;

      if (existing?.vault_secret_id) {
        const { error } = await supabase.rpc('vault_update_secret', {
          p_id: existing.vault_secret_id,
          p_secret: val,
        });
        if (error) throw error;
        vaultId = existing.vault_secret_id;
      } else {
        const { data: newId, error } = await supabase.rpc('vault_create_secret', {
          p_secret: val,
          p_name: secretName,
        });
        if (error) throw error;
        vaultId = newId;
      }

      await supabase
        .from('whatsapp_instance_vault_refs')
        .upsert(
          { instance_id, secret_name: field, vault_secret_id: vaultId },
          { onConflict: 'instance_id,secret_name' },
        );
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error('[upsert-instance-secrets]', err);
    return json(500, { error: String(err) });
  }
});
