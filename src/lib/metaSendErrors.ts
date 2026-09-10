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

// Quem grava `metadata.send_error` são dois, e eles não dizem a mesma coisa:
//
//   meta-webhook ............... { code, title, message, details, href, at }
//   verify-failed-deliveries ... { origem, motivo, at }
//
// Só o primeiro é a Meta afirmando que recusou, e ele só existe em instância
// meta_cloud. O segundo é a NOSSA conclusão de que não veio confirmação de entrega, e
// vale para os três provedores. O código antigo mandava tudo que não tivesse `code`
// mapeado para o mesmo texto, "A Meta recusou o envio desta mensagem" — que numa
// instância Evolution é falso duas vezes: não foi a Meta, e não houve recusa.
// Apareceu em 10/09/2026 num grupo da Evolution, com o cliente tendo recebido o vídeo
// e o áudio que a tela dava como recusados.
export function getSendErrorInfo(metadata: any): SendErrorInfo | null {
  const raw = metadata?.send_error;
  if (!raw) return null;

  if (raw.origem === 'verify-failed-deliveries') {
    // `motivo` é o registro interno ("sem confirmação de entrega após a janela; sem
    // reenvio automático (grupo: ack de falha é por participante)"). Serve para o log,
    // não para a tela: o operador precisa saber o que fazer, não como decidimos.
    const reenvioFalhou = String(raw.motivo ?? '').includes('reenvio automático também falhou');
    return {
      code: null,
      titulo: 'Sem confirmação de entrega',
      motivo: reenvioFalhou
        ? 'O WhatsApp não confirmou a entrega e o reenvio automático também não passou. Reenvie pelo menu da mensagem.'
        : 'O WhatsApp não confirmou a entrega desta mensagem. Se precisar, reenvie pelo menu da mensagem.',
      escopo: 'sistema',
      retryable: true,
    };
  }

  const code = typeof raw.code === 'number' ? raw.code : null;
  const mapped = code != null ? MAP[code] : undefined;
  if (mapped) return { code, ...mapped };

  // Sobrou o que veio do meta-webhook sem código conhecido. Aqui a Meta pode ser
  // nomeada: é o único caminho que grava `title`, e ele só roda em meta_cloud.
  return {
    code,
    titulo: 'Falha no envio',
    motivo: raw.title
      ? `Erro da Meta: ${raw.title}.`
      : 'A Meta recusou o envio desta mensagem.',
    escopo: raw.title ? 'meta' : 'desconhecido',
    retryable: true,
  };
}
