/**
 * Instante que decide comercial × plantão no modo "auto" do modal.
 *
 * Era `opened_at` — a abertura do chat. Foi a reclamação literal do cliente: um
 * chat aberto sexta 16:10 e trabalhado na quinta seguinte às 21:20 saía como
 * comercial. `plantao_em` é o primeiro instante em que um agente trabalhou fora
 * da janela comercial, gravado por trg_zz_set_plantao.
 *
 * trg_zz_set_plantao é `BEFORE UPDATE OF status ... WHEN (new.status = 'closed'
 * AND old.status IS DISTINCT FROM 'closed')`: `plantao_em` só nasce no
 * FECHAMENTO do atendimento, não durante. Medido na Digi Office: 861 de 1.173
 * tickets (73%) são abertos antes de o atendimento fechar, e nesses `plantao_em`
 * é nulo.
 *
 * Por isso NÃO se cai em `opened_at` — que é exatamente o que o cliente
 * reclamou. Sem `plantao_em`, devolve `undefined` e a RPC usa `now()`: no fluxo
 * pré-fechamento o operador está classificando enquanto trabalha, então `now()`
 * mede o instante de trabalho.
 */
export function ancoraTipoHorario(att: { opened_at?: string | null; plantao_em?: string | null }): string | undefined {
  return att.plantao_em ?? undefined;
}
