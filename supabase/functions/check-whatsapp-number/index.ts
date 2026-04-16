import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    // Auth via JWT
    const authHeader = req.headers.get('Authorization') || '';
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { instanceId, phone } = await req.json();
    if (!instanceId || !phone) {
      return new Response(JSON.stringify({ error: 'instanceId and phone required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const cleanPhone = String(phone).replace(/\D/g, '');

    // Get instance
    const { data: instance, error: instErr } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
      .eq('id', instanceId)
      .single();

    if (instErr || !instance) {
      return new Response(JSON.stringify({ error: 'Instance not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const providerType = instance.provider_type || 'self_hosted';

    // Meta: sem suporte
    if (providerType === 'meta_cloud') {
      return new Response(JSON.stringify({ exists: null, unsupported: true }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const secrets = await getInstanceSecrets(supabase, instanceId);

    // Detecta se pode estar faltando o 9
    // Regra: 55 + DDD(2) + 8 dígitos começando com 6-9 → celular sem o 9
    const digits = cleanPhone.replace(/^55/, '');
    const shouldTryWith9 = digits.length === 10 && /^[6-9]/.test(digits.slice(2));
    const phoneWith9 = shouldTryWith9
      ? '55' + digits.slice(0, 2) + '9' + digits.slice(2)
      : null;

    // Z-API
    if (providerType === 'zapi') {
      const base = `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}`;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secrets.zapi_client_token) headers['Client-Token'] = secrets.zapi_client_token;

      const tryPhone = async (p: string): Promise<boolean> => {
        const res = await fetch(`${base}/phone-exists/${p}`, { headers });
        const text = await res.text();
        console.log(`[check-whatsapp-number] Z-API ${p}: ${res.status} ${text}`);
        try { return (JSON.parse(text) as any)?.exists === true; } catch { return false; }
      };

      if (shouldTryWith9 && phoneWith9) {
        // Tenta COM o 9 primeiro (regra BR: celular tem 9)
        const existsWith9 = await tryPhone(phoneWith9);
        if (existsWith9) {
          return new Response(JSON.stringify({ exists: true, phone: phoneWith9, corrected: true }), {
            status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        // Não achou com 9 — tenta sem
        const existsWithout9 = await tryPhone(cleanPhone);
        return new Response(JSON.stringify({ exists: existsWithout9, phone: cleanPhone, corrected: false }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Número fixo ou já tem 9 — tenta direto
      const exists = await tryPhone(cleanPhone);
      return new Response(JSON.stringify({ exists, phone: cleanPhone, corrected: false }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Evolution (self_hosted / cloud)
    const apiUrl = (secrets.api_url || '').replace(/\/$/, '').replace(/\/manager$/, '');
    const identifier = (providerType === 'cloud' && instance.instance_id_external)
      ? instance.instance_id_external
      : instance.instance_name;

    const tryEvolution = async (p: string): Promise<boolean> => {
      const res = await fetch(`${apiUrl}/chat/whatsappNumbers/${identifier}`, {
        method: 'POST',
        headers: { apikey: secrets.api_key || '', 'Content-Type': 'application/json' },
        body: JSON.stringify({ numbers: [p] }),
      });
      const text = await res.text();
      console.log(`[check-whatsapp-number] Evolution ${p}: ${res.status} ${text}`);
      try {
        const data = JSON.parse(text);
        return Array.isArray(data) && data[0]?.exists === true;
      } catch { return false; }
    };

    if (shouldTryWith9 && phoneWith9) {
      // Tenta COM o 9 primeiro
      const existsWith9 = await tryEvolution(phoneWith9);
      if (existsWith9) {
        return new Response(JSON.stringify({ exists: true, phone: phoneWith9, corrected: true }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Não achou com 9 — tenta sem
      const existsWithout9 = await tryEvolution(cleanPhone);
      return new Response(JSON.stringify({ exists: existsWithout9, phone: cleanPhone, corrected: false }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Número fixo ou já tem 9
    const exists = await tryEvolution(cleanPhone);
    return new Response(JSON.stringify({ exists, phone: cleanPhone, corrected: false }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error('[check-whatsapp-number] Error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
