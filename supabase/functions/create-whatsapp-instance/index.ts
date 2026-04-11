// create-whatsapp-instance v1 — suporta super_admin e multi-tenant
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verificar JWT do usuário chamador
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // Cliente autenticado para verificar permissões
    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    // Verificar se é super_admin
    const { data: profile } = await supabaseAuth.from('profiles').select('role, tenant_id').eq('user_id', (await supabaseAuth.auth.getUser()).data.user?.id || '').single();
    
    const isSuperAdmin = profile?.role === 'super_admin';

    const body = await req.json();
    const { target_tenant_id, ...instanceData } = body;

    // Se não é super_admin, só pode criar no próprio tenant
    const tenantId = isSuperAdmin && target_tenant_id ? target_tenant_id : profile?.tenant_id;

    if (!tenantId) return new Response(JSON.stringify({ error: 'tenant_id não encontrado' }), { status: 400, headers: corsHeaders });

    // Usar service_role para bypasear RLS
    const supabase = createClient(supabaseUrl, serviceKey);

    const {
      api_url, api_key, provider_type,
      instance_id_external, meta_phone_number_id,
      meta_access_token, meta_verify_token, meta_app_secret,
      zapi_instance_id, zapi_token, zapi_client_token,
      display_name, instance_name,
    } = instanceData;

    const isMeta = provider_type === 'meta_cloud';
    const isZapi = provider_type === 'zapi';

    // 1. Criar instância
    const { data: instanceResult, error: instanceError } = await supabase
      .from('whatsapp_instances')
      .insert({
        tenant_id: tenantId,
        display_name,
        instance_name,
        provider_type: provider_type || 'self_hosted',
        instance_id_external: instance_id_external || null,
        ...(isMeta && meta_phone_number_id ? { meta_phone_number_id } : {}),
      })
      .select()
      .single();

    if (instanceError) throw instanceError;

    // 2. Criar whatsapp_instance_secrets
    const secretsPayload: any = {
      instance_id: instanceResult.id,
      tenant_id: tenantId,
      api_url: (!isMeta && !isZapi) ? (api_url || null) : null,
    };
    if (isZapi) {
      if (zapi_instance_id) secretsPayload.zapi_instance_id = zapi_instance_id;
      if (zapi_token) secretsPayload.zapi_token = zapi_token;
      if (zapi_client_token) secretsPayload.zapi_client_token = zapi_client_token;
    }

    const { error: secretsError } = await supabase.from('whatsapp_instance_secrets').insert(secretsPayload);
    if (secretsError) throw secretsError;

    // 3. Salvar secrets sensíveis no Vault via upsert-instance-secrets
    const vaultPayload: any = { instance_id: instanceResult.id };
    if (!isMeta && !isZapi) { vaultPayload.api_url = api_url || ''; vaultPayload.api_key = api_key || ''; }
    if (isMeta) {
      if (meta_access_token) vaultPayload.meta_access_token = meta_access_token;
      if (meta_verify_token) vaultPayload.meta_verify_token = meta_verify_token;
      if (meta_app_secret) vaultPayload.meta_app_secret = meta_app_secret;
    }
    if (isZapi) {
      if (zapi_instance_id) vaultPayload.zapi_instance_id = zapi_instance_id;
      if (zapi_token) vaultPayload.zapi_token = zapi_token;
      if (zapi_client_token) vaultPayload.zapi_client_token = zapi_client_token;
    }

    await fetch(`${supabaseUrl}/functions/v1/upsert-instance-secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
      body: JSON.stringify(vaultPayload),
    });

    return new Response(JSON.stringify(instanceResult), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[create-whatsapp-instance]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
