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

/* ---------- treinos ---------- */

export type DesfechoTreino = "realizado" | "no_show" | "cancelado" | "em_aberto";

/**
 * O desfecho vem SÓ do `status`. A coluna `no_show` é uma flag pegajosa gravada por
 * JourneyDetailSheet.tsx:1593 e nunca limpa — ela diz "faltou em algum momento", não
 * "terminou em falta". Usá-la como desfecho fazia uma sessão realizada na 3ª tentativa
 * ser contada como no-show e como realizada ao mesmo tempo.
 */
export function desfechoTreino(status: string | null): DesfechoTreino {
  if (status === "realizado") return "realizado";
  if (status === "no_show") return "no_show";
  if (status === "cancelado") return "cancelado";
  return "em_aberto"; // previsto, agendado, null
}

export interface TreinoLite {
  status: string | null;
  no_show: boolean | null;
  is_retreinamento: boolean | null;
  proprietario_presente: boolean | null;
  conta_como_pdv: boolean | null;
  tentativas: number | null;
}

export interface AgregadoTreinos {
  realizado: number;
  noShow: number;
  cancelado: number;
  emAberto: number;
  /** tudo menos cancelado — denominador de todo percentual */
  validos: number;
  /** flag pegajosa: faltou ao menos uma vez, em qualquer desfecho, cancelado incluído */
  comFalta: number;
  primeiroNoShow: number;
  noShowRate: number;
  realizadoPct: number;
  retreinos: number;
  retreinosPct: number;
  /** sessões realizadas com proprietario_presente preenchido (true OU false) */
  propInformado: number;
  propSim: number;
  /** null quando ninguém informou — sem cobertura não existe percentual */
  propPct: number | null;
  pdvFinalizados: number;
}

export function agregarTreinos(treinos: TreinoLite[]): AgregadoTreinos {
  let realizado = 0, noShow = 0, cancelado = 0, emAberto = 0;
  let comFalta = 0, primeiroNoShow = 0, retreinos = 0;
  let propInformado = 0, propSim = 0, pdvFinalizados = 0;

  treinos.forEach((t) => {
    const d = desfechoTreino(t.status);
    if (d === "realizado") realizado++;
    else if (d === "no_show") noShow++;
    else if (d === "cancelado") cancelado++;
    else emAberto++;

    // A falta é contada mesmo em sessão cancelada: o cliente faltou de verdade.
    if (t.no_show === true) {
      comFalta++;
      if ((t.tentativas ?? 0) <= 1) primeiroNoShow++;
    }

    if (d === "cancelado") return; // fora de todo o resto

    if (t.is_retreinamento === true) retreinos++;
    if (d === "realizado") {
      if (t.proprietario_presente === true || t.proprietario_presente === false) {
        propInformado++;
        if (t.proprietario_presente === true) propSim++;
      }
      if (t.conta_como_pdv === true) pdvFinalizados++;
    }
  });

  const validos = realizado + noShow + emAberto;
  return {
    realizado, noShow, cancelado, emAberto, validos, comFalta, primeiroNoShow,
    noShowRate: pct(noShow, realizado + noShow),
    realizadoPct: pct(realizado, validos),
    retreinos,
    retreinosPct: pct(retreinos, validos),
    propInformado, propSim,
    propPct: propInformado > 0 ? pct(propSim, propInformado) : null,
    pdvFinalizados,
  };
}
