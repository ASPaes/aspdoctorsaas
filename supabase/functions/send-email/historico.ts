/**
 * Conversa completa do atendimento, que vai DEPOIS da assinatura (16/09/2026).
 *
 * Pedido do Alexandre: além do resumo, mandar a conversa inteira do chat. Ela
 * entra embaixo da assinatura, como o histórico de uma resposta de e-mail;
 * antes da assinatura, a assinatura ficaria perdida no meio de dezenas de
 * mensagens. Quem monta o bloco é a tela (a partir das mensagens, sem IA); aqui
 * só se decide a posição, porque a assinatura só existe no servidor.
 */

export interface Historico {
  html: string | null;
  texto: string | null;
}

function inserirNoFim(html: string, trecho: string): string {
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + trecho + html.slice(i) : html + trecho;
}

/** junta o histórico ao corpo que já leva a assinatura */
export function anexarHistorico<T extends { html: string | null; texto: string | null }>(corpo: T, historico: Historico): T {
  const html = historico.html?.trim() || null;
  const texto = historico.texto?.trim() || null;
  if (!html && !texto) return corpo;

  return {
    ...corpo,
    // e-mail sem HTML não ganha HTML por causa do histórico: vai só a versão em texto
    html: corpo.html && html ? inserirNoFim(corpo.html, html) : corpo.html,
    texto: corpo.texto && texto ? `${corpo.texto.replace(/\s+$/, "")}\n\n${texto}` : (corpo.texto ?? texto),
  };
}
