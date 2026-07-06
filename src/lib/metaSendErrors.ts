export type SendErrorScope = 'operador' | 'meta' | 'sistema' | 'desconhecido';

export interface SendErrorInfo {
  code: number | null;
  titulo: string;
  motivo: string;
  escopo: SendErrorScope;
  retryable: boolean;
}

const MAP: Record<number, Omit<SendErrorInfo, 'code'>> = {
  131047: {
    titulo: 'Janela de 24h fechada',
    motivo: 'O cliente não responde há mais de 24h. Para reabrir, envie um template aprovado.',
    escopo: 'operador',
    retryable: false,
  },
  131042: {
    titulo: 'Pendência de pagamento na Meta',
    motivo: 'A conta WhatsApp Business está sem método de pagamento válido. A correção é no Meta Business Manager, fora do DoctorSaaS.',
    escopo: 'meta',
    retryable: false,
  },
  131026: {
    titulo: 'Número indisponível',
    motivo: 'O destino não tem WhatsApp ativo ou não pode receber esta mensagem. Reenviar não resolve.',
    escopo: 'operador',
    retryable: false,
  },
  131053: {
    titulo: 'Falha no upload da mídia',
    motivo: 'A Meta não conseguiu processar o anexo. Tente reenviar.',
    escopo: 'sistema',
    retryable: true,
  },
  131049: {
    titulo: 'Meta bloqueou a entrega',
    motivo: 'A Meta optou por não entregar esta mensagem para preservar a saúde do ecossistema. Evite reenviar imediatamente.',
    escopo: 'meta',
    retryable: false,
  },
  131045: {
    titulo: 'Número não registrado',
    motivo: 'A instância WhatsApp não está registrada corretamente na Meta. Ação técnica na configuração da instância.',
    escopo: 'meta',
    retryable: false,
  },
};

export function getSendErrorInfo(metadata: any): SendErrorInfo | null {
  const raw = metadata?.send_error;
  if (!raw) return null;
  const code = typeof raw.code === 'number' ? raw.code : null;
  const mapped = code != null ? MAP[code] : undefined;
  if (mapped) return { code, ...mapped };
  return {
    code,
    titulo: 'Falha no envio',
    motivo: raw.title ? `Erro da Meta: ${raw.title}.` : 'A Meta recusou o envio desta mensagem.',
    escopo: 'desconhecido',
    retryable: true,
  };
}
