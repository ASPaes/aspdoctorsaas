/**
 * Aritmética do dashboard de Onboarding, isolada da página para poder ser testada
 * sem DOM e sem Supabase.
 *
 * Regra central: jornada CANCELADA não entra em indicador nenhum. Ela aparece só na
 * faixa "Situação agora", que usa a lista completa. Todo o resto do dash come de
 * `ativas` (sem canceladas) ou de `periodo` (sem canceladas e recortada por data de
 * abertura).
 */

export type SituacaoJornada = "nao_iniciado" | "em_andamento" | "parado" | "concluido" | "cancelado";

/** `parado` existe no enum onb_situacao e conta como aberta. Hoje tem 0 linhas. */
export const SITUACOES_ABERTAS: readonly string[] = ["nao_iniciado", "em_andamento", "parado"];

export interface JourneyLite {
  journey_id: string;
  situacao: string | null;
  aberta_em: string | null;
}

export interface ContagemSituacao {
  total: number;
  emAberto: number;
  naoIniciadas: number;
  emAndamento: number;
  paradas: number;
  concluidas: number;
  canceladas: number;
  pctCanceladas: number;
}

export function pct(num: number, den: number): number {
  if (!den) return 0;
  return Math.round((num / den) * 1000) / 10;
}

/** Fim do dia do `to`, mesmo cálculo já usado nos outros filtros da página. */
function fimDoDia(to: Date): number {
  return to.getTime() + 24 * 60 * 60 * 1000 - 1;
}

export function separarJornadas<T extends JourneyLite>(
  journeys: T[],
  range: { from: Date; to: Date },
): { ativas: T[]; periodo: T[] } {
  const ativas = journeys.filter((j) => j.situacao !== "cancelado");
  const de = range.from.getTime();
  const ate = fimDoDia(range.to);
  const periodo = ativas.filter((j) => {
    if (!j.aberta_em) return false;
    const t = new Date(j.aberta_em).getTime();
    return t >= de && t <= ate;
  });
  return { ativas, periodo };
}

export function contarSituacao(journeys: JourneyLite[]): ContagemSituacao {
  let naoIniciadas = 0, emAndamento = 0, paradas = 0, concluidas = 0, canceladas = 0;
  journeys.forEach((j) => {
    switch (j.situacao) {
      case "nao_iniciado": naoIniciadas++; break;
      case "em_andamento": emAndamento++; break;
      case "parado": paradas++; break;
      case "concluido": concluidas++; break;
      case "cancelado": canceladas++; break;
      default: break; // situação desconhecida não vira "aberta" por omissão
    }
  });
  const total = journeys.length;
  return {
    total,
    emAberto: naoIniciadas + emAndamento + paradas,
    naoIniciadas, emAndamento, paradas, concluidas, canceladas,
    pctCanceladas: pct(canceladas, total),
  };
}
