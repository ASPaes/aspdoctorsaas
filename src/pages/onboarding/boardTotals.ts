/**
 * Quem está no quadro de cada pipeline — e, por consequência, o total de tickets de cada um.
 *
 * Mora fora do componente por um motivo só: o total ao lado do pipeline e os badges das
 * colunas precisam sair da MESMA regra. Duas implementações da mesma contagem divergem com
 * o tempo, e o usuário vê 22 no cabeçalho com 24 nas colunas sem ninguém saber quem mente.
 */

export const ONB_DONE_COL_ID = "__onb_concluido__";

/** Implantação encerrada fica no quadro por 30 dias. Depois disso só a busca a traz de volta. */
export const GOLIVE_JANELA_MS = 30 * 24 * 60 * 60 * 1000;

export interface PassagemFase {
  pipeline_id: string | null;
  aberta: boolean;
  concluida_em: string | null;
}

/** O mínimo que a contagem precisa saber de uma jornada. */
export interface JornadaNoQuadro {
  journey_id: string;
  situacao?: string | null;
  current_stage_id: string | null;
}

/**
 * Quando a fase daquela jornada foi encerrada (go-live), em ms. `null` = ainda aberta.
 *
 * Sai da passagem da fase e não de `situacao`, que mente nos dois sentidos: sem fase
 * seguinte o go-live conclui a jornada inteira, e com Acompanhamento ligado ela segue
 * `em_andamento` para sempre.
 */
export function goLiveEmFase(
  passagem: PassagemFase | undefined,
  situacao: string | null | undefined,
): number | null {
  if (!passagem || situacao === "cancelado") return null;
  if (passagem.aberta || !passagem.concluida_em) return null;
  return new Date(passagem.concluida_em).getTime();
}

interface MontarArgs<T extends JornadaNoQuadro> {
  jornadas: T[];
  /** Pipelines da fase, na ordem em que aparecem na barra. */
  pipelineIds: string[];
  /** pipeline → etapas dele, já sem as arquivadas. */
  etapasPorPipeline: Record<string, { id: string }[]>;
  /** A passagem da jornada por ESTA fase. `undefined` = nunca passou por aqui. */
  passagemDaFase: (journeyId: string) => PassagemFase | undefined;
  /** Se a jornada já entrou na fase seguinte — quem seguiu adiante é encerrado lá, não aqui. */
  seguiuAdiante: (journeyId: string) => boolean;
  filtroSituacao: string;
  /** Busca ativa derruba a janela de 30 dias: é assim que se audita um go-live antigo. */
  temBusca: boolean;
  agora: number;
}

/**
 * Um mapa etapa→cartões para CADA pipeline da fase, montado numa passada só.
 * O quadro consome o do pipeline aberto; o total de cada pipeline é a soma das colunas
 * do seu mapa.
 */
export function montarJornadasPorPipeline<T extends JornadaNoQuadro>({
  jornadas,
  pipelineIds,
  etapasPorPipeline,
  passagemDaFase,
  seguiuAdiante,
  filtroSituacao,
  temBusca,
  agora,
}: MontarArgs<T>): Record<string, Record<string, T[]>> {
  const out: Record<string, Record<string, T[]>> = {};
  pipelineIds.forEach((pid) => {
    const m: Record<string, T[]> = {};
    (etapasPorPipeline[pid] ?? []).forEach((s) => (m[s.id] = []));
    m[ONB_DONE_COL_ID] = [];
    out[pid] = m;
  });

  jornadas.forEach((j) => {
    // A jornada só aparece neste board se já percorreu (ou está percorrendo) esta fase.
    const passagem = passagemDaFase(j.journey_id);
    if (!passagem?.pipeline_id) return;
    const m = out[passagem.pipeline_id];
    if (!m) return;

    if (filtroSituacao === "todos" && (j.situacao === "concluido" || j.situacao === "cancelado")) {
      // Go-live dado DENTRO desta fase encerra a jornada aqui — sem treino a fazer, a
      // Implantação nunca começa. O cartão fica na coluna de conclusão pela mesma janela
      // de 30 dias da Implantação (busca derruba a janela) em vez de sumir do quadro.
      // Quem seguiu adiante é encerrado no quadro da fase seguinte; cancelada não fica.
      const golive = goLiveEmFase(passagem, j.situacao ?? null);
      if (golive === null || seguiuAdiante(j.journey_id)) return;
      if (!temBusca && agora - golive > GOLIVE_JANELA_MS) return;
    }

    // Fase já encerrada → coluna de conclusão, para o cartão não sumir do board.
    if (!passagem.aberta) {
      m[ONB_DONE_COL_ID].push(j);
      return;
    }
    if (j.current_stage_id && m[j.current_stage_id]) m[j.current_stage_id].push(j);
  });

  return out;
}

/** Soma as colunas de um pipeline. No Onboarding, 1 cartão = 1 ticket. */
export function somarColunas(mapa: Record<string, unknown[]> | undefined): number {
  if (!mapa) return 0;
  return Object.values(mapa).reduce((acc, arr) => acc + arr.length, 0);
}

/**
 * Total de TICKETS por pipeline na Implantação.
 *
 * Aqui o cartão é o TREINAMENTO, não o ticket: um cliente com três treinos ocupa três
 * colunas. Somar cartão diria 73 onde existem 44 clientes, então o ticket conta uma vez —
 * por isso este número é menor que a soma dos badges das colunas, de propósito.
 */
export function contarTicketsImplantacao({
  treinos,
  jornadasSemTreino,
  pipelineIds,
  pipelineDaJornada,
}: {
  treinos: { journey_id: string }[];
  jornadasSemTreino: { journey_id: string }[];
  pipelineIds: string[];
  pipelineDaJornada: (journeyId: string) => string | null;
}): Record<string, number> {
  const vistos: Record<string, Set<string>> = {};
  pipelineIds.forEach((pid) => (vistos[pid] = new Set()));

  const marcar = (journeyId: string) => {
    const pid = pipelineDaJornada(journeyId);
    if (!pid || !vistos[pid]) return;
    vistos[pid].add(journeyId);
  };
  treinos.forEach((t) => marcar(t.journey_id));
  jornadasSemTreino.forEach((j) => marcar(j.journey_id));

  const out: Record<string, number> = {};
  pipelineIds.forEach((pid) => (out[pid] = vistos[pid].size));
  return out;
}
