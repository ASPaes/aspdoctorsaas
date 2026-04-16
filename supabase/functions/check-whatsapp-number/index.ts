import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth
    const authHeader = req.headers.get('Authorization') || '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const { createClient: createAnonClient } = await import('https://esm.sh/@supabase/supabase-js@2.85.0');
    const anonClient = createAnonClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { instanceId, phone } = await req.json();
    if (!instanceId || !phone) return new Response(JSON.stringify({ error: 'instanceId and phone required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Get instance
    const { data: instance } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
      .eq('id', instanceId)
      .single();

    if (!instance) return new Response(JSON.stringify({ error: 'Instance not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const providerType = instance.provider_type || 'self_hosted';

    // Meta doesn't support phone verification
    if (providerType === 'meta_cloud') {
      return new Response(JSON.stringify({ exists: null, unsupported: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const secrets = await getInstanceSecrets(supabase, instanceId);
    const cleanPhone = phone.replace(/\D/g, '');

    if (providerType === 'zapi') {
      const base = `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secrets.zapi_client_token) headers['Client-Token'] = secrets.zapi_client_token;
      const res = await fetch(`${base}/phone-exists?phone=${cleanPhone}`, { headers });
      if (!res.ok) return new Response(JSON.stringify({ exists: false }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      const data = await res.json();
      return new Response(JSON.stringify({ exists: data?.exists === true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Evolution (self_hosted / cloud)
    const apiUrl = (secrets.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
    const identifier = (providerType === 'cloud' && instance.instance_id_external)
      ? instance.instance_id_external
      : instance.instance_name;
    const res = await fetch(`${apiUrl}/chat/whatsappNumbers/${identifier}`, {
      method: 'POST',
      headers: { apikey: secrets.api_key || '', 'Content-Type': 'application/json' },
      body: JSON.stringify({ numbers: [cleanPhone] }),
    });
    if (!res.ok) return new Response(JSON.stringify({ exists: false }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const data = await res.json();
    const exists = Array.isArray(data) && data[0]?.exists === true;
    return new Response(JSON.stringify({ exists }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[check-whatsapp-number]', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
