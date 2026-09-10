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
 * Era 10 min, e o corte estava no lugar errado. Remedido em 10/09/2026, 14 dias, só
 * grupo, contra a linha de base do próprio grupo (2.136 saídas não condenadas
 * respondem 73,0% em 30 min):
 *
 *   ERROR < 10s ............  63 msgs, 48% respondidas  → abaixo da base, tem sinal
 *   ERROR de 10s a 10 min ..  13 msgs, 69% respondidas  → NA base, sinal zero
 *   ERROR > 1 hora ......... 250 msgs, 84% respondidas  → acima da base, entregues
 *
 * A faixa do meio era condenada e não distingue nada: no agregado, as 221 condenadas
 * do período foram respondidas em 76,5% contra 73,0% das NÃO condenadas — a bolha
 * vermelha em grupo não previa entrega, previa nada.
 *
 * O caso que trouxe isto: em 10/09, 7 mensagens de um grupo enviadas entre 15:08 e
 * 15:15 receberam ERROR entre 15:16:35 e 15:16:41 — 6 segundos para 7 minutos de
 * envios. Fila da Evolution esvaziando, e o cliente já tinha respondido no meio.
 * Vídeo e áudio ficaram com "falha no envio" na tela do operador tendo chegado.
 *
 * O corte em 60s deixa de fora só a faixa < 10s, que é onde a evidência está. Mudar
 * exige deploy só desta function (o CI deploya o que mudou; `_shared` arrasta todas).
 */
export const ERRO_TARDIO_MS = 60 * 1000;

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
      // Em minutos o corte de 60s vira sempre "1 min" no log e some a diferença entre
      // 63s e 9 min. Abaixo de 2 min o motivo sai em segundos.
      motivo: atrasoMs < 120000
        ? `grupo: ERROR chegou ${Math.round(atrasoMs / 1000)}s após o envio (fila do provedor, não falha)`
        : `grupo: ERROR chegou ${Math.round(atrasoMs / 60000)} min após o envio (fila do provedor, não falha)`,
    };
  }

  return { condena: true, atrasoMs, motivo: 'grupo: ERROR imediato' };
}
