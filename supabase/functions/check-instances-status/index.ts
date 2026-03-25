import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function getEvolutionAuthHeaders(apiKey: string): Record<string, string> {
  return { apikey: apiKey };
}

async function ensureWebhookConfigured(
  apiUrl: string,
  apiKey: string,
  instanceName: string,
  webhookUrl: string
): Promise<{ ok: boolean; action: string }> {
  try {
    const headers = getEvolutionAuthHeaders(apiKey);

    // Verificar webhook atual
    const checkResp = await fetch(`${apiUrl}/webhook/find/${instanceName}`, { headers });
    if (checkResp.ok) {
      const current = await checkResp.json();
      const currentUrl = current?.url || current?.webhook?.url || '';
      const currentEnabled = current?.enabled ?? current?.webhook?.enabled ?? false;
      if (currentEnabled && currentUrl === webhookUrl) {
        console.log(`[webhook-check] ${instanceName}: webhook OK`);
        return { ok: true, action: 'noop' };
      }
    }

    // Reconfigurar webhook
    console.log(`[webhook-check] ${instanceName}: reconfigurando webhook...`);
    const setResp = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        enabled: true,
        webhookByEvents: false,
        webhookBase64: false,
        events: [
          'APPLICATION_STARTUP',
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'MESSAGES_DELETE',
          'SEND_MESSAGE',
          'CONNECTION_UPDATE',
        ],
      }),
    });

    if (!setResp.ok) {
      const err = await setResp.text();
      console.error(`[webhook-check] ${instanceName}: erro ao reconfigurar: ${err}`);
      return { ok: false, action: 'reconfigure_failed' };
    }

    console.log(`[webhook-check] ${instanceName}: webhook reconfigurado`);
    return { ok: true, action: 'reconfigured' };
  } catch (err) {
    console.error(`[webhook-check] ${instanceName}: erro:`, err);
    return { ok: false, action: 'error' };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const webhookUrl = `${supabaseUrl}/functions/v1/evolution-webhook`;

    console.log('[check-instances-status] Iniciando verificação');

    const { data: instances, error: instancesError } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external');

    if (instancesError) {
      return new Response(JSON.stringify({ error: 'Failed to fetch instances' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let updatedCount = 0;
    let webhookReconfigured = 0;
    let errorCount = 0;

    for (const instance of instances || []) {
      try {
        const { data: secrets, error: secretsError } = await supabaseAdmin
          .from('whatsapp_instance_secrets')
          .select('api_key, api_url')
          .eq('instance_id', instance.id)
          .single();

        if (secretsError || !secrets) {
          errorCount++;
          continue;
        }

        const providerType = (instance as any).provider_type || 'self_hosted';
        const instanceIdExternal = (instance as any).instance_id_external;
        const instanceIdentifier = providerType === 'cloud' && instanceIdExternal
          ? instanceIdExternal : instance.instance_name;
        const headers = getEvolutionAuthHeaders(secrets.api_key);

        // 1. Verificar status de conexão
        const response = await fetch(
          `${secrets.api_url}/instance/connectionState/${instanceIdentifier}`,
          { headers }
        );

        let newStatus = 'disconnected';
        if (response.ok) {
          const connectionData = await response.json();
          if (connectionData.state === 'open' || connectionData.instance?.state === 'open') {
            newStatus = 'connected';
          } else if (connectionData.state === 'connecting') {
            newStatus = 'connecting';
          }
        }

        // Atualizar status e webhook_url no banco
        await supabaseAdmin
          .from('whatsapp_instances')
          .update({ status: newStatus, webhook_url: webhookUrl, updated_at: new Date().toISOString() })
          .eq('id', instance.id);

        console.log(`[check-instances-status] ${instance.instance_name}: ${newStatus}`);
        updatedCount++;

        // 2. Se conectada, verificar e reconfigurar webhook
        if (newStatus === 'connected') {
          const webhookResult = await ensureWebhookConfigured(
            secrets.api_url, secrets.api_key, instanceIdentifier, webhookUrl
          );
          if (webhookResult.action === 'reconfigured') webhookReconfigured++;
          if (!webhookResult.ok) errorCount++;
        }
      } catch (error) {
        console.error(`[check-instances-status] Erro em ${instance.instance_name}:`, error);
        errorCount++;
      }
    }

    console.log(`[check-instances-status] Concluído: ${updatedCount} atualizadas, ${webhookReconfigured} webhooks reconfigurados, ${errorCount} erros`);

    return new Response(
      JSON.stringify({ success: true, updated: updatedCount, webhooks_reconfigured: webhookReconfigured, errors: errorCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[check-instances-status] Erro fatal:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
