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
