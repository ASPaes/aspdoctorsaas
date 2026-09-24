import { formatMinCal } from "./slaFormat";

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
 * A regra é a mesma para todos os cards: lista, em ordem, as pessoas cuja passagem
 * se sobrepõe à janela medida. Uma pessoa só (o caso comum) sai igual a antes;
 * quando houve troca no meio, sai "Fabianne (<1min) → Geice (7d)" — ninguém é
 * escondido E o tempo de cada um aparece, que é o que separa quem tocou a etapa de
 * quem só encostou nela.
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

export interface PosseNaJanela {
  userId: string;
  /** Início da posse, para ordenar cronologicamente. */
  inicio: number;
  /** Quanto da janela medida esta posse cobre, em ms de calendário. */
  overlap: number;
  /** Fração da janela que esta posse cobre. Janela de duração zero vale 1. */
  fatia: number;
}

/** Posses que encostam na janela, com QUANTO cada uma cobre dela. */
function sobreposicoes(
  periodos: PeriodoResponsavel[],
  de: string | null | undefined,
  ate: string | null | undefined,
): PosseNaJanela[] {
  const ini = ms(de);
  if (ini == null) return [];
  const fim = ms(ate) ?? Date.now();
  // Janela invertida (carimbo torto no banco) vira instante: pergunta ainda responde.
  const hi = Math.max(ini, fim);
  const janela = hi - ini;

  const out: PosseNaJanela[] = [];
  periodos.forEach((p) => {
    const pDe = ms(p.de);
    if (pDe == null) return;
    const pAte = ms(p.ate) ?? Infinity;
    // Sobreposição de intervalos fechados: começou antes do fim e terminou depois
    // do início. `>=` no limite inferior segura a posse que começa exatamente no
    // instante medido — é o caso da distribuição, que abre a janela do 1º contato.
    if (!(pDe <= hi && pAte >= ini)) return;
    const overlap = Math.max(0, Math.min(hi, pAte) - Math.max(ini, pDe));
    out.push({ userId: p.userId, inicio: pDe, overlap, fatia: janela > 0 ? overlap / janela : 1 });
  });
  return out.sort((a, b) => a.inicio - b.inicio);
}

/**
 * A mesma pessoa duas vezes seguidas vira uma, somando o tempo. Reatribuir a jornada
 * a quem já era o dono abre uma posse nova no histórico, e o rótulo saía
 * "Amanda → Amanda" — 16 janelas na Digi Office em 23/09/2026.
 */
function juntarSeguidas(posses: PosseNaJanela[]): PosseNaJanela[] {
  const out: PosseNaJanela[] = [];
  posses.forEach((p) => {
    const anterior = out[out.length - 1];
    if (anterior && anterior.userId === p.userId) {
      anterior.overlap += p.overlap;
      anterior.fatia += p.fatia;
      return;
    }
    out.push({ ...p });
  });
  return out;
}

/**
 * Quem passou pela janela e por quanto tempo, em ordem cronológica.
 *
 * Sem `de`, não há janela para cruzar e a resposta é vazia — quem chama cai no
 * responsável atual. Sem `ate` (medida em aberto, ou contato que nunca aconteceu),
 * a janela vai até agora: é o intervalo que o número realmente cobre.
 */
export function posseNaJanela(
  periodos: PeriodoResponsavel[],
  de: string | null | undefined,
  ate: string | null | undefined,
): PosseNaJanela[] {
  return juntarSeguidas(sobreposicoes(periodos, de, ate));
}

/**
 * Só os nomes, na ordem. TODAS as posses, inclusive as que só encostam — é a
 * pergunta "quem passou por aqui?", que a permanência usa para achar o dono no
 * instante da entrega.
 */
export function responsaveisNaJanela(
  periodos: PeriodoResponsavel[],
  de: string | null | undefined,
  ate: string | null | undefined,
): string[] {
  return posseNaJanela(periodos, de, ate).map((p) => p.userId);
}

/**
 * Corte de ruído de troca de mão (DEM-0471).
 *
 * Mudar a etapa e passar a jornada adiante são dois cliques seguidos, não um só: o
 * carimbo de posse cai segundos DEPOIS do carimbo de entrada na etapa. A posse
 * anterior encosta na janela por esse tanto. Medido em 23/09/2026 na Digi Office:
 * a SKETCH PARAGEM tem 34 SEGUNDOS de Fabianne numa etapa de 7 dias; a WAVE DRINKS,
 * 70 segundos numa de 4h43m.
 *
 * No RÓTULO isso não esconde ninguém — o tempo ao lado do nome já denuncia o
 * encosto. Mas no FILTRO e na MÉDIA sim: sem o corte, filtrar pela Fabianne trazia
 * a etapa inteira de 5d7h para os números dela por causa de 34 segundos.
 *
 * Uma posse vale quando cobre 5 minutos da janela OU 5% dela — o "ou" é o que
 * segura os dois extremos: 3 minutos numa etapa de 20 minutos é trabalho de verdade
 * (entra pela fatia), e 1 hora numa etapa de 7 dias também (entra pelos 5 minutos).
 */
const MIN_SOBREPOSICAO_MS = 5 * 60 * 1000;
const MIN_SOBREPOSICAO_FATIA = 0.05;

export function responsaveisRelevantesNaJanela(
  periodos: PeriodoResponsavel[],
  de: string | null | undefined,
  ate: string | null | undefined,
): string[] {
  const todas = posseNaJanela(periodos, de, ate);
  if (todas.length === 0) return [];
  const vale = (p: PosseNaJanela) => p.overlap >= MIN_SOBREPOSICAO_MS || p.fatia >= MIN_SOBREPOSICAO_FATIA;
  const relevantes = todas.filter(vale);
  // Nunca devolve vazio quando há sobreposição: se todas ficarem abaixo do corte
  // (janela de poucos segundos), fica a maior. Sumir com o único nome seria trocar
  // um defeito por outro.
  if (relevantes.length === 0) return [todas.reduce((a, b) => (b.overlap > a.overlap ? b : a)).userId];
  return relevantes.map((p) => p.userId);
}

/** Espaço rígido, para o nome e o tempo dele não quebrarem em linhas diferentes. */
const ESPACO_RIGIDO = "\u00A0";

/** Tempo de posse ao lado do nome. Abaixo de um minuto o arredondamento mentiria. */
const rotuloDuracao = (overlapMs: number): string =>
  overlapMs < 60000 ? "<1min" : formatMinCal(overlapMs / 60000);

/**
 * Fábrica do que o drill-down consome:
 * `(journeyId, de, ate) => "Fabianne (<1min) → Geice (7d)"`.
 *
 * O tempo só aparece quando houve troca de mão. Numa linha de dono único ele
 * repetiria a coluna Calendário ao lado — ruído em dois terços das linhas.
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
    const posses = posseNaJanela(periodosPorJornada[journeyId] ?? [], de, ate);
    if (posses.length === 0) return fallback(journeyId);
    if (posses.length === 1) return nomeDe(posses[0].userId);
    // Espaço RÍGIDO entre o nome e o tempo: a coluna é estreita e quebrar "Geice" de
    // "(7d)" separaria a pessoa do tempo dela. A quebra cai na seta, onde faz sentido.
    return posses.map((p) => nomeDe(p.userId) + ESPACO_RIGIDO + "(" + rotuloDuracao(p.overlap) + ")").join(" → ");
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
 * Usa o corte de ruído: o que entra nos SEUS números tem de ser trabalho seu. O
 * rótulo continua nomeando todo mundo, com o tempo de cada um — as duas perguntas
 * são diferentes.
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
    const ids = responsaveisRelevantesNaJanela(periodosPorJornada[journeyId] ?? [], de, ate);
    if (ids.length === 0) return true;
    return ids.some((id) => responsavelIds.includes(id));
  };
}
