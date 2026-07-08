import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await anonClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userErr || !user) return json({ error: 'Unauthorized' }, 401);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('is_super_admin, role, tenant_id')
      .eq('user_id', user.id)
      .single();
    if (!profile || (!profile.is_super_admin && profile.role !== 'admin')) {
      return json({ error: 'Forbidden: admin access required' }, 403);
    }

    const { instanceId } = await req.json();
    if (!instanceId) return json({ error: 'instanceId is required' }, 400);

    const { data: instance } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id, tenant_id, instance_name, provider_type, instance_id_external, updated_at')
      .eq('id', instanceId)
      .single();
    if (!instance) return json({ error: 'Instance not found' }, 404);

    // tenant isolation: admin só reinicia instância do próprio tenant
    if (!profile.is_super_admin && profile.tenant_id !== instance.tenant_id) {
      return json({ error: 'Forbidden: instance belongs to another tenant' }, 403);
    }

    if (instance.provider_type !== 'self_hosted' && instance.provider_type !== 'cloud') {
      return json({ error: 'Restart disponível apenas para instâncias Evolution (self_hosted/cloud)' }, 400);
    }

    const { data: secrets, error: secErr } = await supabaseAdmin.rpc('get_instance_secrets', { p_instance_id: instanceId });
    if (secErr || !secrets?.api_url || !secrets?.api_key) {
      return json({ error: 'Instance secrets not found' }, 404);
    }

    const base = String(secrets.api_url).replace(/\/$/, '').replace(/\/manager$/, '');
    const evoId = instance.provider_type === 'cloud' && instance.instance_id_external
      ? instance.instance_id_external
      : instance.instance_name;

    const beforeUpdatedAt = instance.updated_at;

    console.log(`[restart-whatsapp-instance] Restarting ${evoId} (${instanceId})`);
    const restartRes = await fetch(`${base}/instance/restart/${evoId}`, {
      method: 'POST',
      headers: { apikey: secrets.api_key, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const restartBody = await restartRes.text();
    if (!restartRes.ok) {
      console.error('[restart-whatsapp-instance] Restart failed:', restartRes.status, restartBody);
      return json({ restarted: false, event_confirmed: false, error: `Evolution restart falhou (${restartRes.status})` }, 502);
    }

    // Verificação de efeito: o restart gera CONNECTION_UPDATE no webhook,
    // que atualiza whatsapp_instances.updated_at. Poll por até 30s.
    let eventConfirmed = false;
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const { data: fresh } = await supabaseAdmin
        .from('whatsapp_instances')
        .select('updated_at, status')
        .eq('id', instanceId)
        .single();
      if (fresh && fresh.updated_at !== beforeUpdatedAt) {
        eventConfirmed = true;
        break;
      }
    }

    // Estado final reportado pelo Evolution (informativo — pode mentir em sessão zumbi)
    let evoState: string | null = null;
    try {
      const stRes = await fetch(`${base}/instance/connectionState/${evoId}`, { headers: { apikey: secrets.api_key } });
      if (stRes.ok) {
        const st = await stRes.json();
        evoState = st?.state || st?.instance?.state || null;
      }
    } catch (_) { /* informativo */ }

    console.log(`[restart-whatsapp-instance] Done. event_confirmed=${eventConfirmed} state=${evoState}`);
    return json({
      restarted: true,
      event_confirmed: eventConfirmed,
      evolution_state: evoState,
      message: eventConfirmed
        ? 'Restart confirmado — eventos voltaram a chegar.'
        : 'Restart enviado, mas nenhum evento de reconexão foi recebido em 30s. Se o problema persistir, acione o suporte DoctorSaaS.',
    });
  } catch (error) {
    console.error('[restart-whatsapp-instance] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});
