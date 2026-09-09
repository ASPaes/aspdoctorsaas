// Quem pode ser reenviado automaticamente — e quem pode acionar o alarme.
//
// Fica DENTRO da function de propósito (e não em _shared): o CI deploya todas as
// functions quando o _shared muda, e só uma quando não. Mesma razão do
// evolution-webhook/message-shape.ts.
//
// Por que existe: em 12/08/2026 um grupo recebeu a mesma mensagem duas vezes. Não foi
// envio duplicado do operador — foi este reenvio automático. O ack `error` do WhatsApp
// vem POR PARTICIPANTE em grupo, então ele pode ser 1 entre 40 destinatários; e o
// resgate que cancelaria o reenvio (`delivery_confirmed_at`) NUNCA acontece em grupo:
// medido em produção, 0 de 1.449 mensagens de saída em grupo receberam ack de entrega
// em 9 dias, contra 35.116 de 40.086 em conversa direta. Com o resgate impossível,
// todo `error` virava "falhou" e reenviava: 187 mensagens duplicadas (12,9% de tudo que
// sai em grupo) contra 8 em 40.086 nas conversas diretas.

export interface ContextoReenvio {
  /** a conversa é grupo (whatsapp_conversations.is_group) */
  isGroup: boolean;
  messageType: string | null | undefined;
  autoRetryCount: number | null | undefined;
}

export interface DecisaoReenvio {
  /** manda de novo pelo provedor */
  reenviar: boolean;
  /** notifica o agente que a mensagem não chegou */
  alarmar: boolean;
  motivo: string;
}

export function decidirReenvio(ctx: ContextoReenvio): DecisaoReenvio {
  // Marcador interno ("✅ Atendimento 00997/26 iniciado"). O reenvio quebra sozinho —
  // resendMessage trata tudo que não é `text` como mídia e exige media_path — e a
  // notificação é um beco sem saída: a bolha de sistema é um chip centralizado, sem
  // ícone de erro e sem botão de reenviar. Alarme que ninguém consegue atender é ruído.
  if (String(ctx.messageType ?? '') === 'system') {
    return { reenviar: false, alarmar: false, motivo: 'mensagem de sistema' };
  }

  // Em grupo o `error` não condena a mensagem: ele é de um participante/aparelho entre
  // N. Reenviar duplicaria a mensagem para o grupo inteiro. O alarme continua — o
  // operador vê a bolha vermelha e decide reenviar na mão.
  if (ctx.isGroup) {
    return { reenviar: false, alarmar: true, motivo: 'grupo: ack de falha é por participante' };
  }

  if ((ctx.autoRetryCount ?? 0) > 0) {
    return { reenviar: false, alarmar: true, motivo: 'teto de 1 reenvio automático' };
  }

  return { reenviar: true, alarmar: true, motivo: 'conversa direta, primeira tentativa' };
}

// ---------------------------------------------------------------------------------
// ERROR tardio em grupo não condena a mensagem.
//
// Medido em produção em 08/09/2026, 14 dias, comparando com a taxa de resposta do
// cliente em 30 min (63.563 mensagens 1:1 com entrega confirmada respondem 77,9%):
//
//   ERROR chegou < 1 min do envio ......  68 msgs, 54% respondidas  → abaixo do
//                                         baseline, o ERROR diz alguma coisa
//   ERROR chegou > 1 hora do envio ..... 137 msgs, 90% respondidas  → ACIMA do
//                                         baseline de entregues; foram entregues
//
// As 137 são a fila da Evolution sendo esvaziada quando o servidor reinicia: em
// 09/09 entraram 20 ERROR entre 00:31:42 e 00:31:49 para mensagens enviadas entre
// 18:07 e 22:35, exatamente na janela em que todas as instâncias reconectaram.
// Cada uma virava bolha vermelha e notificação para o operador.
//
// Só vale para GRUPO. Em conversa direta o ack é confiável (99,99% das 71 mil saídas
// do período chegaram a `sent` ou acima) e não há medição que justifique mexer.
// ---------------------------------------------------------------------------------

/**
 * Acima disto, o ERROR chegou tarde demais para ser veredito.
 *
 * O corte é 10 min porque é onde a evidência troca de lado. A faixa de 10 a 60 min
 * tem 4 casos em 14 dias — não dá para calibrar com ela, e por isso o número aqui é
 * uma escolha conservadora, não um ótimo medido. Mudar exige deploy só desta
 * function (o CI deploya o que mudou; `_shared` é que arrasta todas).
 */
export const ERRO_TARDIO_MS = 10 * 60 * 1000;

export interface ContextoCondenacao {
  isGroup: boolean;
  /** whatsapp_messages.timestamp — quando a mensagem saiu */
  enviadaEm: string | null | undefined;
  /** whatsapp_messages.last_error_at — quando o ERROR chegou */
  erroEm: string | null | undefined;
}

export interface DecisaoCondenacao {
  /** false = a mensagem volta a "sem confirmação", sem `failed` e sem alarme */
  condena: boolean;
  atrasoMs: number | null;
  motivo: string;
}

export function erroCondenaMensagem(ctx: ContextoCondenacao): DecisaoCondenacao {
  if (!ctx.isGroup) {
    return { condena: true, atrasoMs: null, motivo: 'conversa direta: ack confiável' };
  }

  const t0 = Date.parse(String(ctx.enviadaEm ?? ''));
  const t1 = Date.parse(String(ctx.erroEm ?? ''));

  // Sem os dois carimbos não dá para medir atraso. Mantém o comportamento antigo em
  // vez de absolver por falta de dado — absolver caladamente esconderia falha real.
  if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
    return { condena: true, atrasoMs: null, motivo: 'grupo: sem carimbo para medir o atraso' };
  }

  const atrasoMs = t1 - t0;
  if (atrasoMs > ERRO_TARDIO_MS) {
    return {
      condena: false,
      atrasoMs,
      motivo: `grupo: ERROR chegou ${Math.round(atrasoMs / 60000)} min após o envio (fila do provedor, não falha)`,
    };
  }

  return { condena: true, atrasoMs, motivo: 'grupo: ERROR imediato' };
}
