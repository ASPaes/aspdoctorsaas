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

/**
 * Sugestão de comercial × plantão para um atendimento JÁ ENCERRADO
 * (ClassifyClosureModal, fila de backlog de PendingClosuresTab).
 *
 * Diferente de `ancoraTipoHorario`: ali o operador classifica enquanto
 * trabalha, então `undefined` (⇒ RPC usa `now()`) é o instante certo. Aqui o
 * operador está limpando fila dias depois — `now()` mediria a hora em que a
 * pessoa sentou para classificar, não a hora do atendimento. Medido em
 * produção: 64 de 65 pendentes da Digi Office caem no caminho onde isso
 * importaria.
 *
 * O sistema já calculou a resposta no fechamento
 * (trg_zz_set_plantao / trg_set_attendance_plantao) e gravou em
 * `support_attendances.plantao` / `.plantao_em`. Três casos, nesta ordem:
 *
 * 1. `plantao_em` preenchido → instante real do trabalho fora da janela.
 *    Consultar a RPC nesse instante.
 * 2. Senão, `plantao === false` → o gatilho calculou e não houve trabalho
 *    fora do comercial. Resposta definitiva "comercial", sem RPC.
 * 3. Senão (`plantao` nulo — o `EXCEPTION WHEN OTHERS` do trigger zera os
 *    dois campos quando o cálculo falha, ou a linha é anterior ao recurso) →
 *    `plantao_em IS NULL` sozinho é ambíguo entre "não houve plantão" e "não
 *    deu para calcular". Melhor palpite: consultar pelo `closed_at`.
 */
export type SugestaoTipoHorario = { modo: "comercial" } | { modo: "consultar"; at?: string };

export function sugestaoAtendimentoEncerrado(att: {
  plantao?: boolean | null;
  plantao_em?: string | null;
  closed_at?: string | null;
}): SugestaoTipoHorario {
  if (att.plantao_em) {
    return { modo: "consultar", at: att.plantao_em };
  }
  if (att.plantao === false) {
    return { modo: "comercial" };
  }
  return { modo: "consultar", at: att.closed_at ?? undefined };
}
