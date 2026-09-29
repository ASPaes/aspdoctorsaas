/**
 * "Nova conversa" que cai numa conversa já existente com atendimento encerrado.
 *
 * O defeito: `wa_open_or_reuse_conversation` retoma a conversa (ativa, no nome
 * de quem abriu) mas não cria atendimento — contava com a 1ª mensagem para isso.
 * Desde a DEM-0464 o compositor trava em atendimento encerrado, e o operador
 * que acabou de clicar em "Nova conversa" caía num chat pedindo "Reabrir".
 *
 * Clicar em "Nova conversa" JÁ é a decisão de falar com o cliente, que é o que a
 * DEM-0464 exige. Então o modal deixa o pedido registrado aqui e o chat, ao abrir,
 * dispara o mesmo "Reabrir" do botão — com os mesmos guards (presença, bloqueio
 * de cliente, portão, setor). A trava continua valendo para a aba esquecida.
 *
 * Fica em memória de módulo porque o modal e o chat não se conhecem: o modal é
 * aberto da lista, dos contatos e da Visão 360°, e o chat abre depois, às vezes
 * em outra rota.
 */
const VALIDADE_MS = 60_000;

const pedidos = new Map<string, number>();

export function pedirReaberturaAoAbrir(conversationId: string, agora: number = Date.now()): void {
  pedidos.set(conversationId, agora);
}

/** Lê e apaga: um pedido vale uma abertura só. Pedido velho não reabre nada. */
export function consumirReaberturaPedida(conversationId: string, agora: number = Date.now()): boolean {
  const em = pedidos.get(conversationId);
  if (em === undefined) return false;
  pedidos.delete(conversationId);
  return agora - em <= VALIDADE_MS;
}
