/**
 * Instante que decide comercial × plantão no modo "auto" do modal.
 *
 * Era `opened_at` — a abertura do chat. Foi a reclamação literal do cliente: um
 * chat aberto sexta 16:10 e trabalhado na quinta seguinte às 21:20 saía como
 * comercial. `plantao_em` é o primeiro instante em que um agente trabalhou fora
 * da janela comercial, gravado por trg_zz_set_plantao.
 *
 * trg_zz_set_plantao é BEFORE UPDATE (não INSERT): num ticket aberto no meio da
 * conversa, antes do primeiro UPDATE, plantao_em pode estar nulo. Aí vale
 * opened_at, e sem atendimento nenhum vale `undefined` para a RPC usar now().
 */
export function ancoraTipoHorario(att: { opened_at?: string | null; plantao_em?: string | null }): string | undefined {
  return att.plantao_em ?? att.opened_at ?? undefined;
}
