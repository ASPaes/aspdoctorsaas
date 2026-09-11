// Motor das mensagens agendadas do chat. Chamado pelo pg_cron a cada minuto.
//
// O que ele faz, em ordem:
//   1. `fn_claim_due_scheduled_messages` devolve o lote vencido JA MARCADO como
//      `sending`. A marcacao e o que impede a execucao seguinte do cron de
//      enviar a mesma mensagem duas vezes -- por isso o claim mora no banco,
//      numa instrucao so, e nao aqui.
//   2. Para cada linha: monta o destino, assina com o nome do operador que
//      agendou, manda pelo adapter do provedor, grava em `whatsapp_messages` e
//      atualiza o resumo da conversa.
//   3. `fn_finish_scheduled_message` da o veredito. Falha com tentativa
//      sobrando volta para a fila com espera crescente; na quinta, vira
//      `failed` e avisa o autor no sino.
//   4. Limpa do Storage o anexo de agendamento que morreu (cancelado/falhado
//      ha mais de 7 dias). A `purge-chat-media` nao alcanca esses arquivos:
//      ela so apaga o que virou linha em `whatsapp_messages`.
//
// POR QUE NAO CHAMA A `send-whatsapp-message`: aquela function exige JWT de
// usuario (`auth.getUser`) e aqui nao existe usuario nenhum -- o cron e
// service_role. Dar a ela um caminho de service_role seria abrir portao numa
// function quente para uso interno.
//
// POR QUE A ASSINATURA ESTA DUPLICADA AQUI: o lugar "certo" seria
// `_shared`, mas qualquer mudanca la faz o CI republicar as 87 functions do
// repo (ver CLAUDE.md). Uma copia de 20 linhas custa menos que um deploy-all.
// Se a regra de assinatura mudar na `send-whatsapp-message`, mude aqui junto.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.85.0';
import { getAdapter, getInstanceSecrets } from '../_shared/providers/index.ts';
import { previewCut } from '../_shared/preview.ts';

const LOG = '[dispatch-scheduled-messages]';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Teto por execucao. O cron roda */1 e o envio e sequencial (um provedor nao
// gosta de rajada): 25 mensagens cabem folgadas em um minuto, e o que sobrar
// sai na execucao seguinte, porque continua vencido.
const LOTE = 25;

// Idade do anexo orfao que pode ir embora. 7 dias da tempo de alguem perceber
// que cancelou por engano e reagendar com o mesmo arquivo.
const ORFAO_DIAS = 7;

interface Agendada {
  id: string;
  tenant_id: string;
  conversation_id: string;
  instance_id: string | null;
  created_by: string;
  content: string;
  message_type: string;
  storage_path: string | null;
  media_mimetype: string | null;
  media_file_name: string | null;
  media_size_bytes: number | null;
  scheduled_at: string;
}

interface Assinatura {
  prefixo: string;
  nome: string | null;
  cargo: string | null;
  modo: string;
  valor: string | null;
}

// Espelho do bloco "Signature mode logic" da send-whatsapp-message.
async function resolverAssinatura(
  supabase: any,
  conversation: any,
  userId: string,
): Promise<Assinatura> {
  const modo = conversation.sender_signature_mode || 'name';
  const ticket = conversation.sender_ticket_code || null;

  if (modo === 'ticket') {
    return ticket
      ? { prefixo: `#${ticket}`, nome: null, cargo: null, modo, valor: ticket }
      : { prefixo: '', nome: null, cargo: null, modo, valor: null };
  }
  if (modo !== 'name') {
    return { prefixo: '', nome: null, cargo: null, modo, valor: null };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('funcionario_id, tenant_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile?.funcionario_id) {
    return { prefixo: '', nome: null, cargo: null, modo, valor: null };
  }

  const [func, pref] = await Promise.all([
    supabase.from('funcionarios').select('nome, cargo').eq('id', profile.funcionario_id).maybeSingle(),
    supabase.from('user_preferences').select('signature_name')
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', userId)
      .is('department_id', null)
      .maybeSingle(),
  ]);

  const nome = pref.data?.signature_name || func.data?.nome;
  if (!nome) return { prefixo: '', nome: null, cargo: null, modo, valor: null };

  return { prefixo: `*${nome}*`, nome, cargo: func.data?.cargo || null, modo, valor: nome };
}

async function enviarUma(supabase: any, ag: Agendada): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  // Sem embed de whatsapp_instances aqui: a conversa tem DUAS FKs para
  // instancia (instance_id e current_instance_id) e o PostgREST devolve o
  // embed ambiguo como "nao encontrado".
  const { data: conversation, error: convErr } = await supabase
    .from('whatsapp_conversations')
    .select('id, tenant_id, instance_id, is_group, group_jid, status, sender_signature_mode, sender_ticket_code, whatsapp_contacts!inner(phone_number, name)')
    .eq('id', ag.conversation_id)
    .maybeSingle();

  if (convErr || !conversation) return { ok: false, error: 'conversa nao encontrada' };

  const contact = (conversation as any).whatsapp_contacts;
  if (!contact?.phone_number) return { ok: false, error: 'contato sem telefone' };

  // A instancia gravada no agendamento manda; senao, a da conversa.
  const instanceId = ag.instance_id || conversation.instance_id;
  if (!instanceId) return { ok: false, error: 'conversa sem instancia definida' };

  const [instResult, secrets] = await Promise.all([
    supabase
      .from('whatsapp_instances')
      .select('id, instance_name, provider_type, instance_id_external, meta_phone_number_id')
      .eq('id', instanceId)
      .maybeSingle(),
    getInstanceSecrets(supabase, instanceId),
  ]);

  if (instResult.error || !instResult.data) return { ok: false, error: 'instancia nao encontrada' };
  const instanceData = instResult.data as any;

  const isGroup = conversation.is_group === true;
  const destino = isGroup
    ? (conversation.group_jid || contact.phone_number)
    : (contact.phone_number.includes('@lid')
        ? contact.phone_number
        : contact.phone_number.replace(/\D/g, ''));

  // Anexo: URL assinada curta, igual ao reenvio. O arquivo esta no bucket
  // desde a hora em que o operador agendou.
  let mediaUrl: string | undefined;
  if (ag.message_type !== 'text') {
    if (!ag.storage_path) return { ok: false, error: 'anexo sem caminho no storage' };
    const { data: signed, error: signedErr } = await supabase.storage
      .from('whatsapp-media')
      .createSignedUrl(ag.storage_path, 300);
    if (signedErr || !signed?.signedUrl) return { ok: false, error: 'anexo nao esta mais no storage' };
    mediaUrl = signed.signedUrl;
  }

  const assinatura = await resolverAssinatura(supabase, conversation, ag.created_by);

  const corpo = ag.content || '';
  const conteudoFinal = assinatura.prefixo
    ? (corpo ? `${assinatura.prefixo}\n${corpo}` : assinatura.prefixo)
    : corpo;

  const adapter = getAdapter(instanceData.provider_type || 'self_hosted');
  const sendResult = await adapter.send(secrets, instanceData, {
    to: destino,
    messageType: ag.message_type as any,
    content: conteudoFinal || undefined,
    mediaUrl,
    mediaMimetype: ag.media_mimetype || undefined,
    fileName: ag.media_file_name || undefined,
  });

  const agora = new Date().toISOString();
  const kind = ag.message_type === 'text' ? null : ag.message_type;
  const arquivo = ag.media_file_name || (ag.storage_path ? ag.storage_path.split('/').pop() : null);
  const ext = arquivo && arquivo.includes('.')
    ? arquivo.split('.').pop()!.toLowerCase()
    : (ag.media_mimetype ? ag.media_mimetype.split('/')[1]?.split(';')[0]?.trim() || null : null);

  const { data: msg, error: msgErr } = await supabase
    .from('whatsapp_messages')
    .insert({
      tenant_id: ag.tenant_id,
      conversation_id: ag.conversation_id,
      message_id: sendResult.messageId,
      remote_jid: isGroup ? (conversation.group_jid || contact.phone_number) : contact.phone_number,
      content: conteudoFinal || (ag.message_type === 'text' ? '' : `Sent ${ag.message_type}`),
      message_type: ag.message_type,
      media_url: ag.storage_path || null,
      media_path: ag.storage_path || null,
      media_mimetype: ag.media_mimetype || null,
      media_filename: arquivo,
      media_ext: ext,
      media_size_bytes: ag.media_size_bytes || null,
      media_kind: kind,
      // 'pending' e nao 'sent': quem promove e o ACK do WhatsApp. Nascer 'sent'
      // impediria a escada de status de registrar uma falha depois.
      status: 'pending',
      is_from_me: true,
      timestamp: agora,
      instance_id: instanceId,
      // Carimbar o autor e o que faz esta mensagem contar como mensagem de
      // atendente: tres gatilhos de whatsapp_messages so disparam com
      // `sent_by_user_id` preenchido (abre atendimento em grupo, limpa o
      // "fora do horario", reinicia a regua de inatividade).
      sent_by_user_id: ag.created_by,
      sender_name: assinatura.nome,
      sender_role: assinatura.cargo,
      metadata: {
        sender_signature_mode: assinatura.modo,
        sender_signature_value: assinatura.valor,
        scheduled: true,
        scheduled_message_id: ag.id,
        ...(ag.media_file_name ? { fileName: ag.media_file_name } : {}),
      },
    })
    .select('id')
    .maybeSingle();

  if (msgErr) {
    // A mensagem SAIU para o cliente; so a gravacao falhou. Reenviar seria
    // mandar duas vezes -- entao isto e sucesso com log gritando.
    console.error(`${LOG} mensagem entregue ao provedor mas NAO gravada (ag=${ag.id}):`, msgErr);
    return { ok: true, messageId: undefined };
  }

  const { error: convUpdErr } = await supabase
    .from('whatsapp_conversations')
    .update({
      last_message_at: agora,
      last_message_preview: previewCut(conteudoFinal),
      is_last_message_from_me: true,
      updated_at: agora,
    })
    .eq('id', ag.conversation_id);

  if (convUpdErr) {
    console.error(`${LOG} resumo da conversa ${ag.conversation_id} nao atualizou:`, convUpdErr);
  }

  return { ok: true, messageId: msg?.id };
}

// Anexo de agendamento que nao vai mais virar mensagem.
async function limparOrfaos(supabase: any): Promise<number> {
  const limite = new Date(Date.now() - ORFAO_DIAS * 24 * 60 * 60 * 1000).toISOString();

  const { data: mortas, error } = await supabase
    .from('whatsapp_scheduled_messages')
    .select('id, storage_path')
    .in('status', ['canceled', 'failed'])
    .not('storage_path', 'is', null)
    .lt('updated_at', limite)
    .limit(100);

  if (error || !mortas?.length) return 0;

  const paths = mortas.map((m: any) => m.storage_path).filter(Boolean);
  const { error: rmErr } = await supabase.storage.from('whatsapp-media').remove(paths);
  if (rmErr) {
    console.error(`${LOG} falha ao apagar anexo orfao:`, rmErr);
    return 0;
  }

  // Zerar o caminho e o que impede a proxima execucao de tentar apagar de novo
  // o que ja nao existe. O erro PRECISA ser lido: foi engolindo este retorno
  // que o CHECK errado do anexo passou despercebido no primeiro teste -- o
  // arquivo sumia, a linha continuava apontando para ele e a limpeza repetia
  // para sempre, em silencio.
  const { error: updErr } = await supabase
    .from('whatsapp_scheduled_messages')
    .update({ storage_path: null })
    .in('id', mortas.map((m: any) => m.id));

  if (updErr) {
    console.error(`${LOG} anexo apagado do Storage mas o caminho NAO foi zerado (vai repetir):`, updErr);
  }

  return paths.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  if (req.headers.get('x-warmup') === 'true') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: lote, error: claimErr } = await supabase
      .rpc('fn_claim_due_scheduled_messages', { p_limit: LOTE });

    if (claimErr) {
      console.error(`${LOG} claim falhou:`, claimErr);
      return new Response(JSON.stringify({ error: claimErr.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const agendadas = (lote || []) as Agendada[];
    let enviadas = 0;
    let falhas = 0;

    for (const ag of agendadas) {
      try {
        const r = await enviarUma(supabase, ag);
        if (r.ok) {
          enviadas++;
          await supabase.rpc('fn_finish_scheduled_message', {
            p_id: ag.id, p_ok: true, p_message_id: r.messageId ?? null, p_error: null,
          });
        } else {
          falhas++;
          await supabase.rpc('fn_finish_scheduled_message', {
            p_id: ag.id, p_ok: false, p_message_id: null, p_error: r.error ?? 'erro sem descricao',
          });
          console.warn(`${LOG} ag=${ag.id} nao saiu: ${r.error}`);
        }
      } catch (err: any) {
        falhas++;
        const msg = err?.message || String(err);
        await supabase.rpc('fn_finish_scheduled_message', {
          p_id: ag.id, p_ok: false, p_message_id: null, p_error: msg.substring(0, 500),
        });
        console.error(`${LOG} ag=${ag.id} explodiu:`, msg);
      }
    }

    // A limpeza nunca pode derrubar a execucao: o envio ja aconteceu.
    let orfaos = 0;
    try { orfaos = await limparOrfaos(supabase); } catch (e) {
      console.error(`${LOG} limpeza de orfaos falhou:`, e);
    }

    if (agendadas.length > 0 || orfaos > 0) {
      console.log(`${LOG} lote=${agendadas.length} enviadas=${enviadas} falhas=${falhas} orfaos_apagados=${orfaos}`);
    }

    return new Response(
      JSON.stringify({ processadas: agendadas.length, enviadas, falhas, orfaos }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error(`${LOG} erro inesperado:`, err);
    return new Response(JSON.stringify({ error: err?.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
