import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple HMAC-SHA256 using Web Crypto API
async function signPayload(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const ssoSecret = Deno.env.get('SSO_SHARED_SECRET')!;

    // Verificar JWT do usuário
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 401, headers: corsHeaders });

    // Buscar perfil e tenant
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .single();

    if (!profile) return new Response(JSON.stringify({ error: 'Perfil não encontrado' }), { status: 400, headers: corsHeaders });

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, nome')
      .eq('id', profile.tenant_id)
      .single();

    // Gerar token SSO
    const payload = {
      sub: user.id,
      email: user.email!,
      name: user.user_metadata?.name || user.email!,
      tenant_id: profile.tenant_id,
      tenant_nome: tenant?.nome || '',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60, // 60 segundos
    };

    const payloadB64 = btoa(JSON.stringify(payload));
    const signature = await signPayload(payloadB64, ssoSecret);
    const token = `${payloadB64}.${signature}`;

    return new Response(JSON.stringify({ token }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[generate-sso-token]', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
