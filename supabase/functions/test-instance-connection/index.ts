import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: claimsError } = await anonClient.auth.getUser(token);
    if (claimsError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userId = user.id;
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_super_admin, role')
      .eq('user_id', userId)
      .single();

    if (!profile || (!profile.is_super_admin && profile.role !== 'admin')) {
      return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { instanceId } = await req.json();
    console.log('[test-instance-connection] Testing instance:', instanceId);

    // Fetch instance + secrets table + vault refs in parallel
    const [instanceResult, secretsResult, vaultRefsResult] = await Promise.all([
      supabaseAdmin
        .from('whatsapp_instances')
        .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
        .eq('id', instanceId)
        .single(),
      supabaseAdmin
        .from('whatsapp_instance_secrets')
        .select('api_url, zapi_instance_id, zapi_token, zapi_client_token')
        .eq('instance_id', instanceId)
        .maybeSingle(),
      supabaseAdmin
        .from('whatsapp_instance_vault_refs')
        .select('secret_name, vault_secret_id')
        .eq('instance_id', instanceId),
    ]);

    if (instanceResult.error || !instanceResult.data) {
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build secrets object from table + vault
    const tableSecrets = secretsResult.data || {};
    const secrets: Record<string, any> = { ...tableSecrets };

    // Resolve vault secrets for sensitive fields (api_key, meta_access_token, etc.)
    if (vaultRefsResult.data && vaultRefsResult.data.length > 0) {
      for (const ref of vaultRefsResult.data) {
        // Only fetch from vault if not already in table secrets
        if (!secrets[ref.secret_name]) {
          try {
            const { data: decrypted } = await supabaseAdmin
              .from('vault.decrypted_secrets' as any)
              .select('decrypted_secret')
              .eq('id', ref.vault_secret_id)
              .single();
            if (decrypted?.decrypted_secret) secrets[ref.secret_name] = decrypted.decrypted_secret;
          } catch (_e) {
            // Vault read failed, skip
          }
        }
      }
    }

    if (!secretsResult.data && (!vaultRefsResult.data || vaultRefsResult.data.length === 0)) {
      return new Response(JSON.stringify({ error: 'Instance secrets not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const instance = instanceResult.data as any;
    const providerType = instance.provider_type || 'self_hosted';

    console.log('[test-instance-connection] Provider:', providerType, 'Instance:', instance.instance_name);

    const adapter = getAdapter(providerType);
    const status = await adapter.checkStatus(secrets, instance);

    console.log('[test-instance-connection] Status:', status);

    // Update status in DB
    await supabaseAdmin
      .from('whatsapp_instances')
      .update({ status: status.connected ? 'connected' : 'disconnected', updated_at: new Date().toISOString() })
      .eq('id', instanceId);

    return new Response(
      JSON.stringify({
        connected: status.connected,
        phoneNumber: status.phoneNumber,
        state: status.state,
        error: status.error,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('[test-instance-connection] Error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
