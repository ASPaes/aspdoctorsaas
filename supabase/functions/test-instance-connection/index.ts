import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEvolutionAuthHeaders(apiKey: string, providerType: string): Record<string, string> {
  return { apikey: apiKey };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Validate JWT using Doctor SaaS pattern
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const anonClient = createClient(
      supabaseUrl,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const userId = claimsData.claims.sub;

    // Check if user is tenant admin or super admin
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_super_admin, role')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!profile.is_super_admin && profile.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Forbidden: admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { instanceId } = await req.json();
    console.log('[test-instance-connection] Testing instance:', instanceId);

    const { data: secrets, error: secretsError } = await supabaseAdmin
      .from('whatsapp_instance_secrets')
      .select('api_key, api_url')
      .eq('instance_id', instanceId)
      .single();

    if (secretsError || !secrets) {
      return new Response(JSON.stringify({ error: 'Instance secrets not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const { data: instance, error: instanceError } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('instance_name, provider_type, instance_id_external')
      .eq('id', instanceId)
      .single();

    if (instanceError || !instance) {
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const providerType = (instance as any).provider_type || 'self_hosted';
    const instanceIdExternal = (instance as any).instance_id_external;

    const instanceIdentifier = providerType === 'cloud' && instanceIdExternal
      ? instanceIdExternal
      : instance.instance_name;

    console.log('[test-instance-connection] Testing with identifier:', instanceIdentifier);
    const authHeaders = getEvolutionAuthHeaders(secrets.api_key, providerType);
    
    const response = await fetch(
      `${secrets.api_url}/instance/connectionState/${instanceIdentifier}`,
      { headers: authHeaders }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[test-instance-connection] Error:', errorText);
      return new Response(JSON.stringify({ error: 'Connection test failed', details: errorText }), {
        status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const responseText = await response.text();
    let data: any = {};
    
    if (responseText) {
      try { data = JSON.parse(responseText); } catch (e) {
        console.log('[test-instance-connection] Response is not JSON:', responseText);
      }
    }

    let newStatus = 'disconnected';
    if (!responseText || data.state === 'open' || data.instance?.state === 'open') {
      newStatus = 'connected';
    } else if (data.state === 'connecting') {
      newStatus = 'connecting';
    }

    await supabaseAdmin
      .from('whatsapp_instances')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', instanceId);

    console.log(`[test-instance-connection] Updated status to ${newStatus}`);

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('[test-instance-connection] Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
