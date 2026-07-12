import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';
import { notifyEvent, resolveIncident } from '../_shared/notify.ts';

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
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id, disconnected_alert_at');

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

        // Buscar secrets via Vault RPC
        const secrets = await getInstanceSecrets(supabaseAdmin, instance.id);
        const secretsError = Object.keys(secrets).length === 0;

        if (secretsError) {
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

        // Get previous status before updating
        const { data: prevInstance } = await supabaseAdmin
          .from('whatsapp_instances')
          .select('status, tenant_id')
          .eq('id', instance.id)
          .single();
        const prevStatus = prevInstance?.status || 'unknown';
        const tenantId = prevInstance?.tenant_id;

        await supabaseAdmin
          .from('whatsapp_instances')
          .update({
            status: newStatus,
            ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
            updated_at: new Date().toISOString(),
            ...(newStatus === 'connected' && (instance as any).disconnected_alert_at
              ? { disconnected_alert_at: null }
              : {}),
          })
          .eq('id', instance.id);

        // Log status snapshot only when status changes
        if (newStatus !== prevStatus) {
          await supabaseAdmin
            .from('whatsapp_instance_status_log')
            .insert({
              instance_id: instance.id,
              instance_name: instance.instance_name,
              tenant_id: tenantId,
              status: newStatus,
              was_connected: status.connected,
              alert_sent: false,
            });
        }

        // Alerta in-app via notifyEvent (dedupe/cooldown de 60min gerenciado pela RPC)
        if (newStatus === 'disconnected' && prevStatus === 'connected' && tenantId) {
          try {
            await notifyEvent(
              supabaseAdmin,
              tenantId,
              'whatsapp_instance_disconnected',
              instance.id,
              `Instância desconectada: ${instance.instance_name}`,
              `O WhatsApp da instância "${instance.instance_name}" caiu. Mensagens não estão sendo recebidas nem enviadas. Reconecte no painel de Configurações.`,
              { instance_id: instance.id, instance_name: instance.instance_name },
              '/configuracoes?tab=whatsapp'
            );
          } catch (inappErr) {
            console.error(`[check-instances-status] Erro ao enviar notificação in-app para ${instance.instance_name}:`, inappErr);
          }
        }

        if (newStatus === 'connected' && prevStatus === 'disconnected' && tenantId) {
          try {
            await resolveIncident(supabaseAdmin, tenantId, 'whatsapp_instance_disconnected', instance.id);
          } catch (resolveErr) {
            console.error(`[check-instances-status] Erro ao resolver incidente para ${instance.instance_name}:`, resolveErr);
          }
        }


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
