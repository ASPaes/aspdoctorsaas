import { describe, expect, it } from "vitest";
import { lerResposta, montarPrompt, type Contexto } from "./prompt";

const ctx: Contexto = {
  nome: "Padaria Bom Grão", cancelado: false, clienteDesde: "2022-02-01", certA1: "2026-10-13",
  mrrHoje: 1854.9, mrr12m: 1675,
  atendimentos: [{ codigo: "AT-1", data: "2026-09-20T12:00:00Z", status: "closed", resolucao: "resolvido", assunto: "NFC-e", resumo: "Orientado a usar contingência.", nota: 2, comentario: "Demorou" }],
  tickets: [
    { codigo: "TK-1", assunto: "Balança", aberto: "2026-09-10T12:00:00Z", concluido: null, status: "Aguardando cliente", encerrado: false },
    { codigo: "TK-0", assunto: "NF-e 539", aberto: "2026-08-01T12:00:00Z", concluido: "2026-08-02T12:00:00Z", status: "Concluído", encerrado: true },
  ],
  titulosAbertos: [{ vencimento: "2026-09-10", valor: 1486, situacao: "atrasado", diasAtraso: 15 }],
};

describe("prompt do resumo do Théo", () => {
  it("leva atendimento, ticket aberto, encerrado e título vencido", () => {
    const { user, system } = montarPrompt(ctx);
    expect(user).toContain("nota 2/5");
    expect(user).toContain('comentário: "Demorou"');
    expect(user).toContain("TK-1 | aberto 10/09/2026 | Aguardando cliente");
    expect(user).toContain("ÚLTIMOS TICKETS ENCERRADOS");
    expect(user).toContain("VENCIDO há 15 dias");
    expect(system).toContain("SOMENTE um JSON");
  });
  it("sem título aberto não fala de financeiro", () => {
    expect(montarPrompt({ ...ctx, titulosAbertos: [] }).user).not.toContain("TÍTULOS");
  });
});

describe("leitura da resposta", () => {
  it("aceita JSON cercado de ``` e corta em 3 pontos", () => {
    const r = lerResposta('```json\n{"resumo":"Cliente estável.","pontos":["a","b","c","d",""]}\n```');
    expect(r).toEqual({ resumo: "Cliente estável.", pontos: ["a", "b", "c"] });
  });
  it("texto solto ou resumo vazio devolve null", () => {
    expect(lerResposta("O cliente está bem.")).toBeNull();
    expect(lerResposta('{"resumo":"","pontos":[]}')).toBeNull();
  });
});
