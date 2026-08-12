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
