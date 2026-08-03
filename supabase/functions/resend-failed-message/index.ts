// Edge Function: reenvio de mensagens WhatsApp com falha (status='failed')
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { resendMessage } from '../_shared/resend-message.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LOG = '[resend-failed-message]';
const MAX_RETRIES = 3;
const COOLDOWN_SECONDS = 60;

interface ResendRequest {
  messageId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonError('Unauthorized', 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: authUser }, error: authErr } = await anonClient.auth.getUser(token);
    if (authErr || !authUser) return jsonError('Unauthorized', 401);

    const body: ResendRequest = await req.json();
    if (!body.messageId) return jsonError('messageId é obrigatório', 400);

    const { data: msg, error: msgErr } = await supabase
      .from('whatsapp_messages')
      .select('id, tenant_id, conversation_id, instance_id, content, message_type, media_path, media_mimetype, media_filename, media_kind, status, is_from_me, metadata, remote_jid')
      .eq('id', body.messageId)
      .maybeSingle();

    if (msgErr || !msg) return jsonError('Mensagem não encontrada', 404);
    if (msg.is_from_me !== true) return jsonError('Só mensagens enviadas por você podem ser reenviadas', 400);
    // 'failed' é o veredito do verificador. 'error' é o sinal cru, que ainda aparece em
    // mensagem anterior a este fluxo — o operador continua podendo reenviar à mão.
    if (msg.status !== 'failed' && msg.status !== 'error') {
      return jsonError('Apenas mensagens com falha podem ser reenviadas', 400);
    }

    const { data: senderProfile } = await supabase
      .from('profiles')
      .select('tenant_id, access_status, status, is_super_admin')
      .eq('user_id', authUser.id)
      .maybeSingle();

    if (!senderProfile) return jsonError('Perfil não encontrado', 403);
    const isSuperAdmin = senderProfile.is_super_admin === true;

    if (!isSuperAdmin) {
      const inactive = senderProfile.access_status !== 'ativo' && senderProfile.access_status !== 'active';
      if (inactive) return jsonError('Seu usuário está inativo', 403);
      if (senderProfile.tenant_id !== msg.tenant_id) return jsonError('Sem permissão para esta mensagem', 403);
    }

    const meta = (msg.metadata && typeof msg.metadata === 'object') ? msg.metadata as Record<string, any> : {};
    const retryCount = Number(meta.retry_count || 0);
    const lastRetryAt = meta.last_retry_at ? new Date(meta.last_retry_at) : null;

    if (retryCount >= MAX_RETRIES) {
      return jsonError(`Limite de ${MAX_RETRIES} tentativas atingido. Apague e envie nova mensagem manualmente.`, 429);
    }

    if (lastRetryAt) {
      const elapsedSec = (Date.now() - lastRetryAt.getTime()) / 1000;
      if (elapsedSec < COOLDOWN_SECONDS) {
        const wait = Math.ceil(COOLDOWN_SECONDS - elapsedSec);
        return jsonError(`Aguarde ${wait}s antes de tentar novamente`, 429);
      }
    }

    const outcome = await resendMessage(supabase, msg, { actorUserId: authUser.id, automatic: false });
    if (!outcome.ok) return jsonError(`Falha ao reenviar: ${outcome.error ?? 'erro desconhecido'}`, 502);

    console.log(`${LOG} Reenviada com sucesso: msgId=${msg.id} retry=${retryCount + 1}/${MAX_RETRIES}`);
    return new Response(
      JSON.stringify({ success: true, retryCount: retryCount + 1, maxRetries: MAX_RETRIES }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error(`${LOG} Unexpected:`, err);
    return jsonError('Erro interno', 500);
  }
});

function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
