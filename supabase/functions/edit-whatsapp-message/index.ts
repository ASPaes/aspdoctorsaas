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

// O que a Evolution sabe editar: texto sempre; imagem e vídeo via legenda
// (o formatUpdateMessage dela reenvia o próprio imageMessage/videoMessage com a
// caption nova). Documento, áudio, figurinha e contato ela recusa com
// "Message not compatible" — o frontend também não oferece a opção.
const EDITABLE_TYPES = new Set(['text', 'image', 'video']);
const CAPTION_TYPES = new Set(['image', 'video']);

// Editar legenda só existe a partir da 2.2.0. Nas versões anteriores o
// updateMessage manda SÓ texto: o WhatsApp do cliente recebe uma edição de texto
// para uma mensagem de mídia e a bolha vira outra coisa — sem erro nenhum de
// volta. Por isso a versão é conferida antes, e na dúvida a edição não sai.
const MIN_CAPTION_EDIT_VERSION = [2, 2, 0];

function versionAtLeast(version: string, min: number[]): boolean {
  const parts = version.split('.').map((p) => parseInt(p, 10));
  for (let i = 0; i < min.length; i++) {
    const atual = Number.isFinite(parts[i]) ? parts[i] : 0;
    if (atual > min[i]) return true;
    if (atual < min[i]) return false;
  }
  return true;
}

/** GET / da Evolution devolve `version` sem autenticação. */
async function fetchEvolutionVersion(baseUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(`${baseUrl}/`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    const version = typeof body?.version === 'string' ? body.version.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

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

    const messageType = message.message_type ?? 'text';
    if (!EDITABLE_TYPES.has(messageType)) {
      return fail(
        messageType === 'document' || messageType === 'audio' || messageType === 'ptt'
          ? 'O WhatsApp só permite editar texto e legenda de imagem ou vídeo'
          : 'Este tipo de mensagem não pode ser editado'
      );
    }
    const isCaption = CAPTION_TYPES.has(messageType);

    if (Date.now() - new Date(message.timestamp).getTime() > EDIT_WINDOW_MS) {
      return fail('Mensagens só podem ser editadas em até 15 minutos após o envio', 403);
    }

    if ((message.content ?? '') === body.newContent) {
      return fail(isCaption ? 'A legenda é igual à atual' : 'O texto é igual ao atual');
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

    if (isCaption) {
      const version = await fetchEvolutionVersion(baseUrl);
      if (!version) {
        console.error(`[${FUNCTION_NAME}][${requestId}] Versão da Evolution não lida em ${baseUrl}`);
        return fail('Não foi possível confirmar a versão do servidor de WhatsApp; a legenda não foi alterada');
      }
      if (!versionAtLeast(version, MIN_CAPTION_EDIT_VERSION)) {
        console.warn(`[${FUNCTION_NAME}][${requestId}] Evolution ${version} não edita legenda (mín. ${MIN_CAPTION_EDIT_VERSION.join('.')})`);
        return fail(`O servidor de WhatsApp (Evolution ${version}) não edita legenda de mídia`);
      }
    }

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
