import { describe, expect, it } from "vitest";
import { lerResposta, maxTokensFor, montarPrompt, type ContextoPauta } from "./prompt";

const ctx: ContextoPauta = {
  nome: "Carla Menezes", cargo: "Analista N2", setor: "Suporte",
  periodo: { de: "2026-08-30T03:00:00Z", ate: "2026-09-29T02:59:59Z" },
  grupo: "setor", pessoasNoGrupo: 6,
  encerrados: { valor: 117, time: 69, posicao: 1 },
  csat: { valor: 4.78, time: 4.2, posicao: 2, notas: 49 },
  primeiraRespostaSeg: { valor: 68, time: 199, posicao: 1 },
  tmaSeg: { valor: 908, time: 1278, posicao: 2 },
  resolvidoPrimeiroContatoPct: { valor: null, time: 59, posicao: null },
  reaberturaPct: 4.3, ticketsResolvidos: 20, ticketsAbertos: 3, ticketMaisAntigoDias: 7,
  assuntos: [{ nome: "Periféricos", n: 19, csat: 3.2, notas: 5 }],
  comentarios: [{ nota: 2, texto: "A balança continua sem pesar certo." }],
  jornada: { diasComExpediente: 19, pausaMin: 2045, acimaDoPrevistoMin: 351, motivoMaisAcima: "Café" },
};

describe("pauta do Théo", () => {
  it("monta o prompt com números, comparação e ressalvas", () => {
    const { system, user } = montarPrompt(ctx);
    expect(user).toContain("COMPARADO COM: o setor (6 pessoas)");
    expect(user).toContain("Atendimentos encerrados: 117 | média do grupo 69 | posição 1 de 6");
    expect(user).toContain("1ª resposta (mediana): 1 min 8 s");
    expect(user).toContain("Resolvido no 1º contato: sem dado (IA analisou pouco)");
    expect(user).toContain("Periféricos: 19 atendimentos, CSAT 3.2 em 5 notas");
    expect(user).toContain("351 min de pausa acima do previsto, a maior parte em Café");
    expect(system).toContain("Não use travessão");
  });

  it("lê JSON cercado e corta listas", () => {
    const p = lerResposta('```json\n{"resumo":"Bom mês.","reconhecer":["a","b","c","d"],"conversar":["x"],"desenvolver":[1,"y"]}\n```');
    expect(p).toEqual({ resumo: "Bom mês.", reconhecer: ["a", "b", "c"], conversar: ["x"], desenvolver: ["y"] });
    expect(lerResposta("nada")).toBeNull();
    expect(lerResposta('{"resumo":""}')).toBeNull();
  });

  it("dá folga de tokens só a modelo de raciocínio", () => {
    expect(maxTokensFor("gpt-5-mini")).toBe(16000);
    expect(maxTokensFor("claude-3-5-haiku")).toBe(1500);
  });
});
