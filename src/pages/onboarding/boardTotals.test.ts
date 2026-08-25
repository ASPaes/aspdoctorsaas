import { describe, it, expect } from "vitest";
import {
  ONB_DONE_COL_ID,
  GOLIVE_JANELA_MS,
  montarJornadasPorPipeline,
  somarColunas,
  contarTicketsImplantacao,
  type PassagemFase,
} from "./boardTotals";

const AGORA = new Date("2026-08-12T12:00:00Z").getTime();
const PDV = "pipe-pdv";
const GULA = "pipe-gula";

const ETAPAS = {
  [PDV]: [{ id: "pdv-1" }, { id: "pdv-2" }],
  [GULA]: [{ id: "gula-1" }],
};

function montar(
  jornadas: { journey_id: string; situacao?: string | null; current_stage_id: string | null }[],
  passagens: Record<string, PassagemFase>,
  extra: { filtroSituacao?: string; temBusca?: boolean; seguiram?: string[] } = {},
) {
  return montarJornadasPorPipeline({
    jornadas,
    pipelineIds: [PDV, GULA],
    etapasPorPipeline: ETAPAS,
    passagemDaFase: (id) => passagens[id],
    seguiuAdiante: (id) => (extra.seguiram ?? []).includes(id),
    filtroSituacao: extra.filtroSituacao ?? "todos",
    temBusca: extra.temBusca ?? false,
    agora: AGORA,
  });
}

const aberta = (pipeline: string): PassagemFase => ({ pipeline_id: pipeline, aberta: true, concluida_em: null });
const encerrada = (pipeline: string, quandoMs: number): PassagemFase => ({
  pipeline_id: pipeline,
  aberta: false,
  concluida_em: new Date(quandoMs).toISOString(),
});

describe("montarJornadasPorPipeline", () => {
  it("separa os cartões pelo pipeline que a jornada percorreu, não pela etapa aberta na tela", () => {
    const mapa = montar(
      [
        { journey_id: "a", situacao: "em_andamento", current_stage_id: "pdv-1" },
        { journey_id: "b", situacao: "em_andamento", current_stage_id: "pdv-2" },
        { journey_id: "c", situacao: "em_andamento", current_stage_id: "gula-1" },
      ],
      { a: aberta(PDV), b: aberta(PDV), c: aberta(GULA) },
    );

    expect(somarColunas(mapa[PDV])).toBe(2);
    expect(somarColunas(mapa[GULA])).toBe(1);
  });

  it("o total do pipeline é a soma exata dos badges das colunas", () => {
    const mapa = montar(
      [
        { journey_id: "a", situacao: "em_andamento", current_stage_id: "pdv-1" },
        { journey_id: "b", situacao: "em_andamento", current_stage_id: "pdv-1" },
        { journey_id: "c", situacao: "em_andamento", current_stage_id: "pdv-2" },
      ],
      { a: aberta(PDV), b: aberta(PDV), c: aberta(PDV) },
    );

    expect(mapa[PDV]["pdv-1"]).toHaveLength(2);
    expect(mapa[PDV]["pdv-2"]).toHaveLength(1);
    expect(somarColunas(mapa[PDV])).toBe(2 + 1);
  });

  it("fase encerrada vai para a coluna de conclusão e continua contando", () => {
    const mapa = montar(
      [{ journey_id: "a", situacao: "em_andamento", current_stage_id: "pdv-2" }],
      { a: encerrada(PDV, AGORA - 86_400_000) },
    );

    expect(mapa[PDV][ONB_DONE_COL_ID]).toHaveLength(1);
    expect(somarColunas(mapa[PDV])).toBe(1);
  });

  it("go-live fora dos 30 dias sai da conta — e a busca traz de volta", () => {
    const jornada = [{ journey_id: "a", situacao: "concluido", current_stage_id: "pdv-2" }];
    const passagens = { a: encerrada(PDV, AGORA - GOLIVE_JANELA_MS - 1) };

    expect(somarColunas(montar(jornada, passagens)[PDV])).toBe(0);
    expect(somarColunas(montar(jornada, passagens, { temBusca: true })[PDV])).toBe(1);
  });

  it("quem seguiu para a fase seguinte é contado lá, não aqui", () => {
    const jornada = [{ journey_id: "a", situacao: "concluido", current_stage_id: "pdv-2" }];
    const passagens = { a: encerrada(PDV, AGORA - 86_400_000) };

    expect(somarColunas(montar(jornada, passagens)[PDV])).toBe(1);
    expect(somarColunas(montar(jornada, passagens, { seguiram: ["a"] })[PDV])).toBe(0);
  });

  it("cancelada não fica no quadro, mesmo recém-encerrada", () => {
    const mapa = montar(
      [{ journey_id: "a", situacao: "cancelado", current_stage_id: "pdv-1" }],
      { a: encerrada(PDV, AGORA - 3_600_000) },
    );
    expect(somarColunas(mapa[PDV])).toBe(0);
  });

  it("jornada que nunca passou por esta fase não entra em pipeline nenhum", () => {
    const mapa = montar([{ journey_id: "a", situacao: "em_andamento", current_stage_id: "pdv-1" }], {});
    expect(somarColunas(mapa[PDV])).toBe(0);
    expect(somarColunas(mapa[GULA])).toBe(0);
  });

  it("etapa que não é do pipeline da jornada não vira cartão fantasma", () => {
    // A jornada percorreu o Gula mas a etapa atual é do PDV — estado inconsistente que
    // não pode inflar o total de nenhum dos dois.
    const mapa = montar([{ journey_id: "a", situacao: "em_andamento", current_stage_id: "pdv-1" }], {
      a: aberta(GULA),
    });
    expect(somarColunas(mapa[GULA])).toBe(0);
    expect(somarColunas(mapa[PDV])).toBe(0);
  });

  it("situação escolhida à mão manda, inclusive fora da janela de 30 dias", () => {
    const mapa = montar(
      [{ journey_id: "a", situacao: "concluido", current_stage_id: "pdv-2" }],
      { a: encerrada(PDV, AGORA - GOLIVE_JANELA_MS * 10) },
      { filtroSituacao: "concluido" },
    );
    expect(somarColunas(mapa[PDV])).toBe(1);
  });
});

describe("somarColunas", () => {
  it("deixa a coluna de conclusão de fora quando pedida em `exceto`", () => {
    const mapa = { "st-1": [1, 2], "st-2": [3], [ONB_DONE_COL_ID]: [4, 5, 6] };

    expect(somarColunas(mapa)).toBe(6);
    expect(somarColunas(mapa, [ONB_DONE_COL_ID])).toBe(3);
  });
});

describe("contarTicketsImplantacao", () => {
  const pipelineDaJornada = (id: string) => (id.startsWith("gula") ? GULA : PDV);

  it("conta o ticket uma vez só, mesmo com três treinos em colunas diferentes", () => {
    const totais = contarTicketsImplantacao({
      treinos: [
        { journey_id: "pdv-a" },
        { journey_id: "pdv-a" },
        { journey_id: "pdv-a" },
        { journey_id: "pdv-b" },
      ],
      jornadasSemTreino: [],
      pipelineIds: [PDV, GULA],
      pipelineDaJornada,
    });

    expect(totais[PDV]).toBe(2);
  });

  it("soma a jornada que entrou na Implantação sem nenhum treino marcado", () => {
    const totais = contarTicketsImplantacao({
      treinos: [{ journey_id: "pdv-a" }],
      jornadasSemTreino: [{ journey_id: "pdv-b" }],
      pipelineIds: [PDV, GULA],
      pipelineDaJornada,
    });

    expect(totais[PDV]).toBe(2);
  });

  it("não conta duas vezes quem aparece nas duas listas", () => {
    const totais = contarTicketsImplantacao({
      treinos: [{ journey_id: "pdv-a" }],
      jornadasSemTreino: [{ journey_id: "pdv-a" }],
      pipelineIds: [PDV, GULA],
      pipelineDaJornada,
    });

    expect(totais[PDV]).toBe(1);
  });

  it("cada pipeline fica com os seus, e pipeline vazio é 0 e não sumiço", () => {
    const totais = contarTicketsImplantacao({
      treinos: [{ journey_id: "pdv-a" }, { journey_id: "gula-a" }, { journey_id: "gula-a" }],
      jornadasSemTreino: [],
      pipelineIds: [PDV, GULA, "pipe-vazio"],
      pipelineDaJornada,
    });

    expect(totais[PDV]).toBe(1);
    expect(totais[GULA]).toBe(1);
    expect(totais["pipe-vazio"]).toBe(0);
  });

  it("não conta o ticket que já deu go-live — ele está na coluna de conclusão", () => {
    const totais = contarTicketsImplantacao({
      treinos: [{ journey_id: "pdv-a" }, { journey_id: "pdv-b" }],
      jornadasSemTreino: [{ journey_id: "pdv-c" }],
      pipelineIds: [PDV, GULA],
      pipelineDaJornada,
      concluida: (id) => id === "pdv-b" || id === "pdv-c",
    });

    expect(totais[PDV]).toBe(1);
  });

  it("jornada sem passagem por esta fase não é atribuída a ninguém", () => {
    const totais = contarTicketsImplantacao({
      treinos: [{ journey_id: "orfa" }],
      jornadasSemTreino: [],
      pipelineIds: [PDV, GULA],
      pipelineDaJornada: () => null,
    });

    expect(totais[PDV]).toBe(0);
    expect(totais[GULA]).toBe(0);
  });
});
