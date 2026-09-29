import { describe, expect, it } from "vitest";
import type { Atendimento360 } from "@/components/clientes/visao360/visao360Calc";
import type { AtendimentoJornada } from "@/components/atendimento/useAtendimentoJornada";
import {
  assuntos, destaques, diaDaSemanaSP, diaSP, excessoDePausa, horaSP, inicioDaSemana, linhaDoTempo, mapaDeHorarios, porSemana,
} from "./colaborador360Analise";
import type { Metricas360 } from "./colaborador360Calc";

const at = (o: Partial<Atendimento360>): Atendimento360 => ({
  id: Math.random().toString(36).slice(2), attendance_code: null, status: "closed",
  opened_at: "2026-09-22T13:00:00Z", closed_at: "2026-09-22T13:20:00Z",
  first_response_time_seconds: 60, handle_seconds: 1200, assigned_to: "u", department_id: null, departamento: null,
  contact_name: null, is_group: false, resolucao: "resolvido", ticket_id: null, ai_summary: null, ai_category: "Fiscal",
  sentimento: null, conversation_id: null, csat_score: null, csat_reason: null, csat_respondido_em: null, ...o,
});
const DE = new Date("2026-09-01T03:00:00Z");
const ATE = new Date("2026-09-30T02:59:59Z");

describe("fuso de São Paulo", () => {
  it("dia, hora e dia da semana", () => {
    const t = new Date("2026-09-22T02:30:00Z"); // 21/09 23:30 em SP, segunda
    expect(diaSP(t)).toBe("2026-09-21");
    expect(horaSP(t)).toBe(23);
    expect(diaDaSemanaSP(t)).toBe(0);
  });
  it("início da semana é segunda", () => {
    expect(inicioDaSemana("2026-09-27")).toBe("2026-09-21"); // domingo
    expect(inicioDaSemana("2026-09-21")).toBe("2026-09-21");
  });
});

describe("porSemana e mapa", () => {
  it("agrupa por semana sem buracos e ignora fora do período", () => {
    const s = porSemana([
      at({ opened_at: "2026-09-22T13:00:00Z", csat_score: 5 }),
      at({ opened_at: "2026-09-23T13:00:00Z", csat_score: 3 }),
      at({ opened_at: "2026-10-05T13:00:00Z" }),
    ], DE, ATE);
    expect(s[0].inicio).toBe("2026-08-31");
    const w = s.find((x) => x.inicio === "2026-09-21")!;
    expect(w.atendimentos).toBe(2);
    expect(w.csat).toBe(4);
    expect(s.reduce((a, x) => a + x.atendimentos, 0)).toBe(2);
  });
  it("mapa de horários no fuso de SP", () => {
    const { grade, max } = mapaDeHorarios([at({ opened_at: "2026-09-22T13:00:00Z" })], DE, ATE); // terça 10h
    expect(grade[1][10 - 7]).toBe(1);
    expect(max).toBe(1);
  });
});

describe("assuntos e destaques", () => {
  const lista = [
    ...Array.from({ length: 3 }, () => at({ ai_category: "Periféricos", csat_score: 2 })),
    ...Array.from({ length: 5 }, () => at({ ai_category: "Fiscal", csat_score: 5, csat_reason: "ótimo" })),
  ];
  it("ordena por volume com CSAT por assunto", () => {
    const a = assuntos(lista, DE, ATE);
    expect(a[0]).toMatchObject({ nome: "Fiscal", n: 5, csat: 5 });
    expect(a[1]).toMatchObject({ nome: "Periféricos", csat: 2 });
  });
  it("aponta forte e atenção só com dado suficiente", () => {
    const m = { elegivel: true, n: 6, grupo: "setor", pos: { frt: 1 }, csat_n: 8 } as unknown as Metricas360;
    const d = destaques(m, lista, DE, ATE, null, 1);
    expect(d.map((x) => x.titulo)).toEqual([
      "1ª resposta mais rápida do setor",
      "5 elogios de clientes",
      "CSAT cai para 2,0 em Periféricos",
      "1 ticket parado há mais de 7 dias",
    ]);
    const m2 = { elegivel: true, n: 2, grupo: "setor", pos: { frt: 1 } } as unknown as Metricas360;
    expect(destaques(m2, [], DE, ATE, null, 0)).toEqual([]);
  });
});

const jornada = (pausas: Partial<AtendimentoJornada["pausas"][number]>[]) =>
  ({ pausas: pausas.map((p) => ({ user_id: "u", nome: "", dia: "", inicio: "2026-09-22T13:00:00Z", fim: null, segundos: 0, motivo: "Café", previsto_min: 15, estimada: false, em_andamento: false, ...p })) }) as AtendimentoJornada;

describe("pausas e linha do tempo", () => {
  it("excesso ignora pausa sem previsão e em andamento", () => {
    const e = excessoDePausa(jornada([
      { segundos: 30 * 60 }, { segundos: 10 * 60 }, { segundos: 40 * 60, previsto_min: null }, { segundos: 90 * 60, em_andamento: true },
    ]));
    expect(e.segundos).toBe(15 * 60);
    expect(e.pausas).toBe(1);
  });
  it("resume atendimentos por dia e lista o resto um a um", () => {
    const dias = linhaDoTempo(
      [at({ closed_at: "2026-09-22T13:20:00Z" }), at({ closed_at: "2026-09-22T15:00:00Z", csat_score: 1, csat_respondido_em: "2026-09-22T16:00:00Z" })],
      [{ id: "t", ticket_code: "TK-1", assunto: "Balança", aberto_em: "2026-09-21T14:00:00Z", concluido_em: null, status_final: false, responsavel_user_id: "u", criado_por: "u" }],
      jornada([{ segundos: 40 * 60 }]),
      "u", DE, ATE,
    );
    expect(dias.map((d) => d.dia)).toEqual(["2026-09-22", "2026-09-21"]);
    expect(dias[0].eventos.map((e) => e.tipo)).toEqual(["avaliacao", "atendimentos", "pausa"]);
    expect(dias[0].eventos[1].titulo).toBe("2 atendimentos encerrados");
    expect(dias[1].eventos[0].titulo).toBe("Abriu TK-1");
  });
});
