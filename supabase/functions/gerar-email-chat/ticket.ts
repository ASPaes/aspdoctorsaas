/**
 * E-mail escrito a partir de um TICKET (etapa 2, item 3 do mockup aprovado em
 * 16/09/2026). A mesma tela do chat, com o texto saindo do histórico do chamado.
 *
 * Nota interna nunca vai para o e-mail. Por padrão ela nem chega à IA: o
 * histórico entregue traz o que o cliente já poderia ver (abertura, mudanças de
 * status, encerramento, e-mails trocados e o resumo registrado). Quem quiser que
 * a IA LEIA as notas para entender o caso liga a opção na tela; mesmo assim o
 * texto final fala com o cliente e não copia nota nenhuma.
 */

/** eventos que descrevem o andamento do chamado, sem conteúdo interno */
const EVENTOS_PUBLICOS: Record<string, string> = {
  created: 'Chamado aberto',
  status_change: 'Status',
  closed: 'Chamado encerrado',
  email_cliente: 'E-mail do cliente',
  email_reaberto: 'Reaberto por e-mail do cliente',
  email_continuacao: 'Continuação de outro chamado',
  reclassification: 'Reclassificado',
  department_change: 'Trocou de setor',
  ai_summary: 'Resumo registrado',
};

/** conteúdo interno da equipe: só entra se a tela pedir, e só como contexto */
const EVENTOS_INTERNOS: Record<string, string> = {
  comment: 'Nota interna',
  checklist: 'Checklist',
  assignment_change: 'Responsável',
};

export interface EventoTicket {
  event_type: string;
  content: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

export const eventoVisivel = (tipo: string, comNotas: boolean) =>
  tipo in EVENTOS_PUBLICOS || (comNotas && tipo in EVENTOS_INTERNOS);

const MAX_CHARS_EVENTO = 700;

export function formatarEventos(
  eventos: EventoTicket[],
  comNotas: boolean,
  hora: (iso: string) => string,
): string {
  return eventos
    .filter((e) => eventoVisivel(e.event_type, comNotas))
    .map((e) => {
      const rotulo = EVENTOS_PUBLICOS[e.event_type] ?? EVENTOS_INTERNOS[e.event_type] ?? e.event_type;
      let texto = (e.content ?? '').trim();
      if (!texto && e.new_value) texto = e.old_value ? `${e.old_value} para ${e.new_value}` : String(e.new_value);
      if (!texto) texto = '';
      if (texto.length > MAX_CHARS_EVENTO) texto = `${texto.slice(0, MAX_CHARS_EVENTO)}…`;
      return `[${hora(e.created_at)}] ${rotulo}${texto ? `: ${texto}` : ''}`;
    })
    .join('\n');
}

export interface CabecalhoTicket {
  ticket_code: string | null;
  assunto: string | null;
  descricao: string | null;
  aberto_em: string;
  status: string | null;
  encerrado_em: string | null;
}

export function cabecalhoDoTicket(t: CabecalhoTicket, hora: (iso: string) => string): string {
  return [
    `Chamado ${t.ticket_code ?? ''} aberto em ${hora(t.aberto_em)}${t.encerrado_em ? `, encerrado em ${hora(t.encerrado_em)}` : ''}`,
    `Assunto: ${t.assunto ?? '(sem assunto)'}`,
    t.status ? `Status atual: ${t.status}` : null,
    t.descricao ? `Descrição da abertura: ${t.descricao.slice(0, 1500)}` : null,
  ].filter(Boolean).join('\n');
}
