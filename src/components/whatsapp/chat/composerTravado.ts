/**
 * DEM-0464 — quando o compositor do chat para de aceitar digitação.
 *
 * O defeito: uma aba esquecida aberta num chat já encerrado continuava com o
 * compositor vivo. A mensagem saía, e a edge function `send-whatsapp-message`
 * ABRIA um atendimento novo no nome de quem digitou, mandando ao cliente
 * "Atendimento XXXXX/26 aberto com sucesso". Medido em 30 dias de produção:
 * 281 atendimentos abertos assim pelo mesmo agente que acabara de encerrar um
 * na mesma conversa, 86 deles sem o cliente dizer uma palavra.
 *
 * Função pura porque as três exceções abaixo são o que separa a correção de uma
 * regressão, e cada uma custou uma medição para ser encontrada.
 */
export interface EstadoAtendimentoComposer {
  /**
   * Status do atendimento mais recente da conversa, ou `undefined`/`null`
   * quando a conversa NUNCA teve atendimento nenhum.
   */
  status?: string | null;
  /** Enquanto carrega, não trava: senão o compositor pisca a cada troca de chat. */
  carregando: boolean;
  ehGrupo: boolean;
}

const ATIVOS = ["waiting", "in_progress"];

export function atendimentoEncerradoParaDigitar(e: EstadoAtendimentoComposer): boolean {
  // Grupo fica de fora: ali a conversa é contínua e quem abre atendimento é o
  // botão próprio do cabeçalho (start_group_attendance), nunca a 1ª mensagem.
  if (e.ehGrupo) return false;
  if (e.carregando) return false;
  // Conversa que nunca teve atendimento é o contato ativo, em que o operador
  // legitimamente puxa o assunto (353 mensagens/mês). Essa segue livre.
  if (!e.status) return false;
  return !ATIVOS.includes(e.status);
}
