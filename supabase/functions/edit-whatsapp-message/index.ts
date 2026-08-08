import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getInstanceSecrets } from '../_shared/providers/index.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FUNCTION_NAME = 'edit-whatsapp-message';

// Editar mensagem existe no endpoint /chat/updateMessage da Evolution. Meta Cloud
// e Z-API não têm equivalente — o frontend já esconde a opção, isto é a rede.
const EDIT_SUPPORTED_PROVIDERS = new Set(['self_hosted', 'cloud']);

// Limite do próprio WhatsApp.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

interface EditMessageRequest {
  messageId: string;
  conversationId: string;
  newContent: string;
}

function fail(error: string, status = 200) {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = crypto.randomUUID().slice(0, 8);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: authUser }, error: claimsError } = await anonClient.auth.getUser(token);
    if (claimsError || !authUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body: EditMessageRequest = await req.json();
    console.log(`[${FUNCTION_NAME}][${requestId}] Request:`, {
      messageId: body.messageId,
      conversationId: body.conversationId,
    });

    if (!body.messageId || !body.conversationId || !body.newContent?.trim()) {
      return fail('messageId, conversationId e newContent são obrigatórios', 400);
    }

    // A mensagem é a fonte da verdade: ela carrega instance_id e remote_jid.
    // Antes esta função lia isso da conversa com um embed
    // `whatsapp_instances!inner`, que é AMBÍGUO — whatsapp_conversations tem duas
    // FKs para whatsapp_instances (instance_id e current_instance_id). O
    // PostgREST recusava o embed e o erro virava "Conversation not found",
    // mascarando a causa. Nenhuma edição jamais passou daqui.
    const { data: message, error: msgError } = await supabase
      .from('whatsapp_messages')
      .select('id, message_id, conversation_id, instance_id, remote_jid, is_from_me, content, original_content, timestamp, message_type, delete_status, status')
      .eq('message_id', body.messageId)
      .eq('conversation_id', body.conversationId)
      .maybeSingle();

    if (msgError) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Erro ao buscar mensagem:`, msgError.message);
      return fail('Erro ao buscar a mensagem');
    }
    if (!message) {
      return fail('Mensagem não encontrada');
    }

    if (!message.is_from_me) {
      return fail('Você só pode editar suas próprias mensagens', 403);
    }

    if (message.delete_status === 'revoked' || message.message_type === 'revoked') {
      return fail('Mensagem apagada não pode ser editada');
    }

    if (message.message_type !== 'text') {
      return fail('Só mensagens de texto podem ser editadas');
    }

    if (Date.now() - new Date(message.timestamp).getTime() > EDIT_WINDOW_MS) {
      return fail('Mensagens só podem ser editadas em até 15 minutos após o envio', 403);
    }

    if ((message.content ?? '') === body.newContent) {
      return fail('O texto é igual ao atual');
    }

    // Instância: a da mensagem; a da conversa só como rede de segurança para
    // linhas antigas gravadas sem instance_id.
    let instanceId: string | null = message.instance_id;
    if (!instanceId) {
      const { data: conversation } = await supabase
        .from('whatsapp_conversations')
        .select('instance_id, current_instance_id')
        .eq('id', body.conversationId)
        .maybeSingle();
      instanceId = (conversation as any)?.current_instance_id ?? (conversation as any)?.instance_id ?? null;
    }

    if (!instanceId) {
      return fail('Não foi possível identificar a instância de WhatsApp desta mensagem');
    }

    const { data: instance, error: instError } = await supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type')
      .eq('id', instanceId)
      .maybeSingle();

    if (instError || !instance) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Instância não encontrada:`, instanceId, instError?.message);
      return fail('Instância de WhatsApp não encontrada');
    }

    const providerType = (instance as any).provider_type || 'self_hosted';
    if (!EDIT_SUPPORTED_PROVIDERS.has(providerType)) {
      return fail(
        providerType === 'meta_cloud'
          ? 'WhatsApp Oficial (Meta) não permite editar mensagens'
          : `Provedor "${providerType}" não permite editar mensagens`
      );
    }

    const secrets = await getInstanceSecrets(supabase, instanceId);
    if (!secrets.api_key || !secrets.api_url) {
      return fail('Credenciais da instância não encontradas');
    }

    let baseUrl = secrets.api_url.endsWith('/') ? secrets.api_url.slice(0, -1) : secrets.api_url;
    baseUrl = baseUrl.replace(/\/manager$/, '');

    const endpoint = `${baseUrl}/chat/updateMessage/${(instance as any).instance_name}`;
    const remoteJid = message.remote_jid;
    if (!remoteJid) {
      return fail('Mensagem sem destinatário registrado');
    }

    const requestBody = {
      number: remoteJid.replace(/@.*$/, ''),
      text: body.newContent,
      key: {
        remoteJid,
        fromMe: true,
        id: body.messageId,
      },
    };

    const evolutionResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: secrets.api_key },
      body: JSON.stringify(requestBody),
    });

    if (!evolutionResponse.ok) {
      const errorText = await evolutionResponse.text();
      console.error(`[${FUNCTION_NAME}][${requestId}] Evolution ${evolutionResponse.status}:`, errorText);
      return fail(`Falha ao editar a mensagem no WhatsApp (${evolutionResponse.status})`);
    }

    await supabase
      .from('whatsapp_message_edit_history')
      .insert({
        message_id: body.messageId,
        conversation_id: body.conversationId,
        previous_content: message.content,
      });

    // original_content guarda a PRIMEIRA versão: na 2ª edição ele não pode ser
    // sobrescrito pelo texto intermediário.
    const originalContent = message.original_content || message.content;

    const { data: updatedMessage, error: updateError } = await supabase
      .from('whatsapp_messages')
      .update({
        content: body.newContent,
        original_content: originalContent,
        edited_at: new Date().toISOString(),
      })
      .eq('id', message.id)
      .select()
      .single();

    if (updateError) {
      console.error(`[${FUNCTION_NAME}][${requestId}] Erro no update:`, updateError.message);
      return fail('Mensagem editada no WhatsApp, mas o painel não conseguiu atualizar');
    }

    console.log(`[${FUNCTION_NAME}][${requestId}] OK: ${message.id}`);

    return new Response(
      JSON.stringify({ success: true, message: updatedMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error(`[${FUNCTION_NAME}][${requestId}] Erro inesperado:`, error);
    return fail('Erro interno do servidor', 500);
  }
});
