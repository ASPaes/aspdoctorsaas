import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getAdapter } from '../_shared/providers/index.ts';

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
    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const evolutionWebhookUrl = `${supabaseUrl}/functions/v1/evolution-webhook`;
    const zapiWebhookUrl = `${supabaseUrl}/functions/v1/zapi-webhook`;

    console.log('[check-instances-status] Iniciando verificação');

    const { data: instances, error: instancesError } = await supabaseAdmin
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id');

    if (instancesError) {
      return new Response(JSON.stringify({ error: 'Failed to fetch instances' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let checked = 0;
    let webhookReconfigured = 0;
    let errorCount = 0;

    for (const instance of instances || []) {
      try {
        const providerType = (instance as any).provider_type || 'self_hosted';

        // Meta Cloud: status verificado via Graph API — não precisa de secrets locais para status
        // mas precisamos dos secrets para checkStatus
        const { data: secrets, error: secretsError } = await supabaseAdmin
          .from('whatsapp_instance_secrets')
          .select('api_url, api_key, zapi_instance_id, zapi_token, zapi_client_token, meta_access_token')
          .eq('instance_id', instance.id)
          .maybeSingle();

        if (secretsError || !secrets) {
          console.warn(`[check-instances-status] Sem secrets para ${instance.instance_name}`);
          errorCount++;
          continue;
        }

        const adapter = getAdapter(providerType);
        const status = await adapter.checkStatus(secrets as any, instance as any);
        const newStatus = status.connected ? 'connected' : 'disconnected';

        // Determina qual webhook URL usar por provider
        const webhookUrl = providerType === 'zapi'
          ? zapiWebhookUrl
          : providerType === 'meta_cloud'
            ? null  // Meta configura webhook via painel
            : evolutionWebhookUrl;

        await supabaseAdmin
          .from('whatsapp_instances')
          .update({
            status: newStatus,
            ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
            updated_at: new Date().toISOString(),
          })
          .eq('id', instance.id);

        console.log(`[check-instances-status] ${instance.instance_name} (${providerType}): ${newStatus}`);
        checked++;

        // Reconfigura webhook automaticamente apenas para Evolution (Z-API e Meta são manuais)
        if (status.connected && (providerType === 'self_hosted' || providerType === 'cloud')) {
          const webhookResult = await adapter.configureWebhook(secrets as any, instance as any, evolutionWebhookUrl);
          if (webhookResult.action === 'reconfigured') webhookReconfigured++;
          if (!webhookResult.ok) errorCount++;
        }

      } catch (error) {
        console.error(`[check-instances-status] Erro em ${instance.instance_name}:`, error);
        errorCount++;
      }
    }

    console.log(`[check-instances-status] Concluído: ${checked} verificadas, ${webhookReconfigured} webhooks reconfigurados, ${errorCount} erros`);

    return new Response(
      JSON.stringify({ success: true, checked, webhooks_reconfigured: webhookReconfigured, errors: errorCount }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );

  } catch (error) {
    console.error('[check-instances-status] Erro fatal:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
