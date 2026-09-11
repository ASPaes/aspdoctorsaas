/**
 * Quem era responsável pela jornada DURANTE a janela que o número mede.
 *
 * O drill-down mostrava sempre o responsável de HOJE, tirado de
 * `vw_onboarding_journeys`. Como a jornada troca de mão ao entrar na Implantação,
 * o implantador levava o crédito (ou a culpa) do 1º contato, das etapas e do SLA de
 * onboarding que outra pessoa fez. Medido em 11/09/2026 no tenant Digi Office:
 * 16 das 51 jornadas de setembro trocaram de responsável, e 10 das 27 linhas do
 * card "1º contato" mostravam o nome errado.
 *
 * A regra é a mesma para todos os cards: lista, em ordem, TODAS as pessoas cuja
 * passagem se sobrepõe à janela medida. Uma pessoa só (o caso comum) sai igual a
 * antes; quando houve troca no meio, sai "Fabianne → Igor" — nenhum dos dois nomes
 * é escondido, que é o defeito que se está corrigindo.
 */

export interface PeriodoResponsavel {
  userId: string;
  /** ISO. Início da posse. */
  de: string;
  /** ISO ou null quando ainda é o responsável. */
  ate: string | null;
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * Pessoas cuja posse se sobrepõe a [de, ate], em ordem cronológica.
 *
 * Sem `de`, não há janela para cruzar e a resposta é vazia — quem chama cai no
 * responsável atual. Sem `ate` (medida em aberto, ou contato que nunca aconteceu),
 * a janela vai até agora: é o intervalo que o número realmente cobre.
 */
export function responsaveisNaJanela(
  periodos: PeriodoResponsavel[],
  de: string | null | undefined,
  ate: string | null | undefined,
): string[] {
  const ini = ms(de);
  if (ini == null) return [];
  const fim = ms(ate) ?? Date.now();
  // Janela invertida (carimbo torto no banco) vira instante: pergunta ainda responde.
  const hi = Math.max(ini, fim);

  return periodos
    .filter((p) => {
      const pDe = ms(p.de);
      if (pDe == null) return false;
      const pAte = ms(p.ate) ?? Infinity;
      // Sobreposição de intervalos fechados: começou antes do fim e terminou depois
      // do início. `>=` no limite inferior segura a posse que começa exatamente no
      // instante medido — é o caso da distribuição, que abre a janela do 1º contato.
      return pDe <= hi && pAte >= ini;
    })
    .sort((a, b) => (ms(a.de) ?? 0) - (ms(b.de) ?? 0))
    .map((p) => p.userId);
}

/**
 * Fábrica do que o drill-down consome: `(journeyId, de, ate) => "Fabianne → Igor"`.
 *
 * `fallback` é o responsável atual da jornada, usado quando não há histórico que
 * cruze a janela — jornada antiga, anterior ao carimbo, não pode virar "—".
 */
export function criarResolvedorResponsavel(
  periodosPorJornada: Record<string, PeriodoResponsavel[]>,
  nomeDe: (userId: string) => string,
  fallback: (journeyId: string) => string,
) {
  return (journeyId: string, de: string | null | undefined, ate: string | null | undefined): string => {
    const ids = responsaveisNaJanela(periodosPorJornada[journeyId] ?? [], de, ate);
    if (ids.length === 0) return fallback(journeyId);
    return ids.map(nomeDe).join(" → ");
  };
}

/**
 * O filtro de Responsável RECORTA A MEDIDA, não apenas escolhe jornadas — mesma
 * régua que `pipelineSelecionado` já aplica às fases.
 *
 * A primeira versão selecionava a jornada inteira que "passou pela mão" da pessoa.
 * Mas a janela que o número mede é bem mais estreita que a vida da jornada: a
 * Natural Aires foi distribuída para a Amanda em 08/09, ela fez o 1º contato 1h50m
 * depois, e a Fabianne só assumiu em 11/09 — o contato aparecia no filtro da
 * Fabianne com o nome da Amanda. Medido em 11/09/2026: no filtro do Igor, 5 das 9
 * linhas de 1º contato eram trabalho de outra pessoa.
 *
 * Em "Tempo total" isto não muda nada: lá a janela É a jornada inteira, então quem
 * passou por ela está na janela por definição.
 *
 * Jornada sem histórico passa. Ela só chegou até aqui porque o responsável ATUAL
 * bateu com o filtro, e sem carimbo não há como afirmar que a janela não é dela —
 * sumir com ela seria trocar um erro por outro.
 */
export function criarRecorteResponsavel(
  periodosPorJornada: Record<string, PeriodoResponsavel[]>,
  responsavelIds: string[],
) {
  return (journeyId: string, de: string | null | undefined, ate: string | null | undefined): boolean => {
    if (responsavelIds.length === 0) return true;
    const ids = responsaveisNaJanela(periodosPorJornada[journeyId] ?? [], de, ate);
    if (ids.length === 0) return true;
    return ids.some((id) => responsavelIds.includes(id));
  };
}
