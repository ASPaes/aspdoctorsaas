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
  concluido_em: string | null;
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

/**
 * `periodo` = jornadas que estavam VIVAS em algum momento do intervalo, não as que
 * nasceram dentro dele.
 *
 * Recortar por data de abertura responde "das que começaram em julho, quantas
 * cumpriram o prazo" — uma coorte retrospectiva. Não é o que o dashboard precisa:
 * jornada aberta em julho e ainda rodando tem SLA correndo AGORA e sumia da tela na
 * virada do mês. Com 37 das 41 jornadas ativas da Digi Office nessa situação, o SLA
 * abria zerado em agosto.
 *
 * A regra é a sobreposição de intervalos: abriu antes do fim da janela E não tinha
 * sido concluída antes do começo dela.
 */
export function separarJornadas<T extends JourneyLite>(
  journeys: T[],
  range: { from: Date; to: Date },
): { ativas: T[]; periodo: T[] } {
  const ativas = journeys.filter((j) => j.situacao !== "cancelado");
  const de = range.from.getTime();
  const ate = fimDoDia(range.to);
  const periodo = ativas.filter((j) => {
    if (!j.aberta_em) return false;
    if (new Date(j.aberta_em).getTime() > ate) return false;
    if (!j.concluido_em) return true; // ainda aberta: o SLA corre agora
    return new Date(j.concluido_em).getTime() >= de;
  });
  return { ativas, periodo };
}

/** Só depende de `situacao` — não exige a jornada inteira. */
export function contarSituacao(journeys: Array<{ situacao: string | null }>): ContagemSituacao {
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
 * O desfecho vem SÓ do `status` — ele responde "como o treino terminou".
 *
 * Desde 11/08 o desfecho `no_show` é praticamente residual: marcar no-show devolve o
 * treino para `previsto` e o manda de volta para a fila de agendamento, porque a falta
 * é um EVENTO, não o fim da história. Quem conta falta é `no_shows` (ver
 * `agregarTreinos`), não este desfecho. As linhas anteriores a 11/08 ainda param aqui.
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
  /** Contador de faltas. `tentativas` NÃO serve: sobe no no-show e na remarcação. */
  no_shows: number | null;
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
  /** treinos que faltaram ao menos uma vez, em qualquer desfecho, cancelado incluído */
  comFalta: number;
  /** total de faltas: o mesmo treino pode ter faltado 3 vezes */
  faltas: number;
  /** % dos válidos que faltaram ao menos uma vez */
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
  let comFalta = 0, faltas = 0, retreinos = 0;
  let propInformado = 0, propSim = 0, pdvFinalizados = 0;

  treinos.forEach((t) => {
    const d = desfechoTreino(t.status);
    if (d === "realizado") realizado++;
    else if (d === "no_show") noShow++;
    else if (d === "cancelado") cancelado++;
    else emAberto++;

    // A falta é contada mesmo em sessão cancelada: o cliente faltou de verdade.
    // O contador manda; a flag pegajosa cobre as linhas anteriores ao backfill de 11/08.
    const faltasDoTreino = (t.no_shows ?? 0) > 0 ? (t.no_shows as number) : (t.no_show === true ? 1 : 0);
    if (faltasDoTreino > 0) {
      comFalta++;
      faltas += faltasDoTreino;
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
    realizado, noShow, cancelado, emAberto, validos, comFalta, faltas,
    noShowRate: pct(comFalta, validos),
    realizadoPct: pct(realizado, validos),
    retreinos,
    retreinosPct: pct(retreinos, validos),
    propInformado, propSim,
    propPct: propInformado > 0 ? pct(propSim, propInformado) : null,
    pdvFinalizados,
  };
}

/* ---------- atribuição de etapa por responsável ---------- */

/** Uma passagem por etapa, já com o dono que ela teve na época. */
export interface LinhaAtribuicao {
  journey_id: string;
  stage_id: string;
  responsavel_user_id: string | null;
  duracao_util_minutos: number | null;
  duracao_minutos: number | null;
}

export interface ResponsavelAgg {
  userId: string | null;
  count: number;
  sumUtil: number;
  sumCal: number;
  dentroDoSla: number;
  pctNoPrazo: number;
}

/**
 * Agrega passagens de etapa por responsável.
 *
 * "No prazo" é avaliado ETAPA A ETAPA contra o SLA daquela etapa — não contra um
 * alvo do responsável, que não existe. Etapa sem SLA cadastrado fica de fora: sem
 * alvo, "no prazo" não quer dizer nada e ela só inflaria o denominador.
 * A comparação é em minutos ÚTEIS, a mesma base do cadastro de SLA.
 */
export function agregarPorResponsavel(
  linhas: LinhaAtribuicao[],
  slaPorEtapa: Record<string, number | null>,
): ResponsavelAgg[] {
  const m = new Map<string | null, { count: number; sumUtil: number; sumCal: number; dentroDoSla: number }>();
  linhas.forEach((l) => {
    const alvo = slaPorEtapa[l.stage_id];
    if (!alvo || alvo <= 0) return;
    const util = l.duracao_util_minutos ?? 0;
    const cur = m.get(l.responsavel_user_id) ?? { count: 0, sumUtil: 0, sumCal: 0, dentroDoSla: 0 };
    cur.count += 1;
    cur.sumUtil += util;
    cur.sumCal += l.duracao_minutos ?? 0;
    if (util <= alvo) cur.dentroDoSla += 1;
    m.set(l.responsavel_user_id, cur);
  });
  return Array.from(m.entries())
    .map(([userId, v]) => ({ userId, ...v, pctNoPrazo: pct(v.dentroDoSla, v.count) }))
    .sort((a, b) => b.count - a.count);
}

/* ---------- tempo de entrega ---------- */

export interface JourneyTempo {
  journey_id: string;
  situacao: string | null;
  aberta_em: string | null;
  concluido_em: string | null;
  implantacao_iniciada_em?: string | null;
  implantacao_concluida_em?: string | null;
}

export interface MediaTempo {
  /** Média dos valores medidos. `null` quando nada foi medido. */
  media: number | null;
  /** Quantos entraram na média. */
  n: number;
  /** Quantos estavam na coorte — o denominador honesto. */
  total: number;
}

/** `null` conta no denominador e fica fora do numerador: não medido não é zero. */
export function mediaTempo(valores: Array<number | null>): MediaTempo {
  const medidos = valores.filter((v): v is number => v != null);
  return {
    media: medidos.length ? medidos.reduce((s, v) => s + v, 0) / medidos.length : null,
    n: medidos.length,
    total: valores.length,
  };
}

function dentroDaJanela(iso: string | null | undefined, range: { from: Date; to: Date }): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= range.from.getTime() && t <= fimDoDia(range.to);
}

/**
 * Coorte de CONCLUSÃO — jornadas que terminaram dentro da janela.
 *
 * Diferente do `periodo` de `separarJornadas`, que é sobreposição de intervalos e
 * inclui jornada ainda aberta. As duas regras convivem de propósito: o resto do
 * painel responde "como está o SLA agora" e precisa da jornada aberta; "quanto
 * levou" só jornada terminada responde.
 */
export function coorteConcluidas<T extends JourneyTempo>(journeys: T[], range: { from: Date; to: Date }): T[] {
  return journeys.filter((j) => j.situacao !== "cancelado" && dentroDaJanela(j.concluido_em, range));
}

/** Coorte de implantação: precisa dos DOIS carimbos, e o de fim dentro da janela. */
export function coorteImplantacao<T extends JourneyTempo>(journeys: T[], range: { from: Date; to: Date }): T[] {
  return journeys.filter(
    (j) => j.situacao !== "cancelado" && !!j.implantacao_iniciada_em && dentroDaJanela(j.implantacao_concluida_em, range),
  );
}

/** Minutos corridos entre dois carimbos. `null` se faltar algum. */
export function minutosEntre(de: string | null | undefined, ate: string | null | undefined): number | null {
  if (!de || !ate) return null;
  return (new Date(ate).getTime() - new Date(de).getTime()) / 60000;
}
