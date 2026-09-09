import { describe, it, expect } from "vitest";
import kpiHelp from "@/lib/kpiHelp";
import { kpiCatalog, entradasDaArea, entradaPorId } from "./index";
import { PROVIDERS, PREFIXO_AREA, type KpiArea } from "./types";

/** O catálogo é escrito à mão, área por área. Estes testes são a rede que
 *  pega o erro humano que sempre acontece: id repetido, helpKey que não
 *  existe, provider inventado. */
describe("kpiCatalog — invariantes", () => {
  it("não tem id repetido", () => {
    const ids = kpiCatalog.map((e) => e.id);
    const repetidos = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(repetidos).toEqual([]);
  });

  it("todo helpKey declarado existe no kpiHelp", () => {
    const orfaos = kpiCatalog
      .filter((e) => e.helpKey && !(e.helpKey in kpiHelp))
      .map((e) => `${e.id} → ${e.helpKey}`);
    expect(orfaos).toEqual([]);
  });

  it("todo provider declarado está na lista de providers", () => {
    const invalidos = kpiCatalog
      .filter((e) => !(PROVIDERS as readonly string[]).includes(e.source.provider))
      .map((e) => `${e.id} → ${e.source.provider}`);
    expect(invalidos).toEqual([]);
  });

  it("todo path é preenchido e sem espaço", () => {
    const ruins = kpiCatalog
      .filter((e) => !e.source.path.trim() || /\s/.test(e.source.path))
      .map((e) => e.id);
    expect(ruins).toEqual([]);
  });

  it("o id começa com o prefixo da própria área", () => {
    const fora = kpiCatalog
      .filter((e) => !e.id.startsWith(PREFIXO_AREA[e.area]))
      .map((e) => `${e.id} (área ${e.area})`);
    expect(fora).toEqual([]);
  });

  it("gráfico disponível declara span e render; card não declara nenhum dos dois", () => {
    const graficoIncompleto = kpiCatalog
      .filter((e) => e.kind === "chart" && !e.pending && (!e.span || !e.render))
      .map((e) => e.id);
    const cardComSobra = kpiCatalog
      .filter((e) => e.kind === "card" && (e.span !== undefined || e.render !== undefined))
      .map((e) => e.id);
    expect({ graficoIncompleto, cardComSobra }).toEqual({
      graficoIncompleto: [],
      cardComSobra: [],
    });
  });

  it("só gráfico pode ser pending — card embutido na aba não existe", () => {
    const cardsPending = kpiCatalog
      .filter((e) => e.pending && e.kind !== "chart")
      .map((e) => e.id);
    expect(cardsPending).toEqual([]);
  });

  it("entradasDaArea devolve só a área pedida", () => {
    const areas: KpiArea[] = ["atendimento", "financeiro", "cs", "implantacao", "certificados"];
    for (const area of areas) {
      expect(entradasDaArea(area).every((e) => e.area === area)).toBe(true);
    }
  });

  it("entradaPorId acha o que existe e devolve undefined para o que não existe", () => {
    expect(entradaPorId("at.volume_total")?.label).toBe("Total de atendimentos");
    expect(entradaPorId("nao.existe")).toBeUndefined();
  });
});
