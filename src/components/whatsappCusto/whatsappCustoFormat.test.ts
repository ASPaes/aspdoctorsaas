import { describe, expect, it } from "vitest";
import { agruparOrigens, ehAutomacao, origemInfo, seloDoValor } from "./whatsappCustoFormat";

const l = (origem: string, qtd: number, pct: number, custo_rs = qtd * 0.035) => ({ origem, qtd, pct, custo_rs });

describe("agruparOrigens", () => {
  it("junta as automações pequenas numa linha 'outras'", () => {
    const r = agruparOrigens([
      l("tecnico_conteudo", 900, 90),
      l("fora_horario", 4, 0.4),
      l("aviso_pausa", 2, 0.2),
      l("boas_vindas", 94, 9.4),
    ]);
    expect(r.map((x) => x.origem)).toEqual(["tecnico_conteudo", "boas_vindas", "outras"]);
    expect(r[2]).toMatchObject({ qtd: 6, pct: 0.6, n: 2 });
  });

  it("nunca esconde as evitáveis nem as dos técnicos, mesmo pequenas", () => {
    const r = agruparOrigens([
      l("tecnico_conteudo", 980, 98),
      l("tecnico_template", 5, 0.5),
      l("csat_cutucao", 5, 0.5),
      l("ura_resposta_invalida", 3, 0.3),
      l("fora_horario", 4, 0.4),
      l("aviso_pausa", 3, 0.3),
    ]);
    const nomes = r.map((x) => x.origem);
    expect(nomes).toContain("tecnico_template");
    expect(nomes).toContain("csat_cutucao");
    expect(nomes).toContain("ura_resposta_invalida");
    expect(nomes).toContain("outras");
  });

  it("uma linha pequena sozinha fica com o próprio nome", () => {
    const r = agruparOrigens([l("tecnico_conteudo", 990, 99), l("fora_horario", 10, 1)]);
    expect(r.map((x) => x.origem)).toEqual(["tecnico_conteudo", "fora_horario"]);
  });
});

describe("seloDoValor", () => {
  it("real vence a simulação", () => {
    expect(seloDoValor("real", { periodo_todo: true }).tom).toBe("real");
  });
  it("período todo antes de 01/10 é simulação", () => {
    expect(seloDoValor("estimado", { periodo_todo: true }).tom).toBe("simulacao");
  });
  it("período que cruza 01/10 é estimado", () => {
    expect(seloDoValor("estimado", { periodo_todo: false }).tom).toBe("estimado");
    expect(seloDoValor("estimado", null).tom).toBe("estimado");
  });
});

describe("origemInfo", () => {
  it("origem nova do banco não quebra a tela", () => {
    expect(origemInfo("tipo_novo_qualquer")).toEqual({ rotulo: "tipo novo qualquer", tom: "automatica" });
  });
  it("só as origens tecnico_* ficam fora da tabela de automações", () => {
    expect(ehAutomacao("tecnico_rajada")).toBe(false);
    expect(ehAutomacao("ura_menu")).toBe(true);
    expect(ehAutomacao("template")).toBe(true);
  });
});
