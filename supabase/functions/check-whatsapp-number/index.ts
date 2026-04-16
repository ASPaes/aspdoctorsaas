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

    // Z-API
    if (providerType === 'zapi') {
      const base = `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secrets.zapi_client_token) headers['Client-Token'] = secrets.zapi_client_token;

      const tryPhone = async (p: string) => {
        const res = await fetch(`${base}/phone-exists/${p}`, { headers });
        const text = await res.text();
        console.log(`[check-whatsapp-number] Z-API ${p}: ${res.status} ${text}`);
        try { return (JSON.parse(text) as any)?.exists === true; } catch { return false; }
      };

      // Primeira tentativa com número como digitado
      const exists = await tryPhone(cleanPhone);
      if (exists) {
        return new Response(JSON.stringify({ exists: true, phone: cleanPhone }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Se 10 dígitos após DDI (55) e primeiro dígito do número é 6-9 → tentar com 9
      // cleanPhone tem DDI: 55 + DDD (2) + número (8 ou 9)
      // sem 9: 55 + 2 + 8 = 12 dígitos; com 9: 55 + 2 + 9 = 13 dígitos
      const digits = cleanPhone.replace(/^55/, ''); // remove DDI
      const shouldTryWith9 = digits.length === 10 && /^[6-9]/.test(digits.slice(2));

      if (shouldTryWith9) {
        const phoneWith9 = '55' + digits.slice(0, 2) + '9' + digits.slice(2);
        const existsWith9 = await tryPhone(phoneWith9);
        if (existsWith9) {
          return new Response(JSON.stringify({ exists: true, phone: phoneWith9, corrected: true }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }

      return new Response(JSON.stringify({ exists: false, phone: cleanPhone }), {
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
    const text = await res.text();
    console.log(`[check-whatsapp-number] Evolution ${cleanPhone}: ${res.status} ${text}`);

    let exists = false;
    let correctedPhone: string | null = null;
    try {
      const data = JSON.parse(text);
      exists = Array.isArray(data) && data[0]?.exists === true;
    } catch { exists = false; }

    // Se não encontrou e pode ter 9 faltando
    if (!exists) {
      const digits = cleanPhone.replace(/^55/, '');
      const shouldTryWith9 = digits.length === 10 && /^[6-9]/.test(digits.slice(2));
      if (shouldTryWith9) {
        const phoneWith9 = '55' + digits.slice(0, 2) + '9' + digits.slice(2);
        console.log(`[check-whatsapp-number] Evolution retry with 9: ${phoneWith9}`);
        const res2 = await fetch(`${apiUrl}/chat/whatsappNumbers/${identifier}`, {
          method: 'POST',
          headers: { apikey: secrets.api_key || '', 'Content-Type': 'application/json' },
          body: JSON.stringify({ numbers: [phoneWith9] }),
        });
        try {
          const data2 = JSON.parse(await res2.text());
          if (Array.isArray(data2) && data2[0]?.exists === true) {
            exists = true;
            correctedPhone = phoneWith9;
          }
        } catch { /* ignore */ }
      }
    }

    return new Response(JSON.stringify({
      exists,
      phone: correctedPhone || cleanPhone,
      corrected: !!correctedPhone,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[check-whatsapp-number]', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
