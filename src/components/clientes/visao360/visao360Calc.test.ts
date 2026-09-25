import { describe, expect, it } from "vitest";
import {
  FILTROS_ATENDIMENTO_VAZIOS, filtrarOrdenarAtendimentos,
  kpisAtendimento, kpisCsat, kpisTicket, mapaDeContato, montarLinhaDoTempo, mrrEm, periodoAnterior, serieMrr12m,
  type Atendimento360, type Movimento360, type Produto360, type Ticket360,
} from "./visao360Calc";

const prod = (o: Partial<Produto360>): Produto360 => ({
  id: "p", produto: "Gestão", vlr_mensal: 100, ativo: true, data_cancelamento: null,
  data_ativacao: null, data_venda: null, data_proximo_reajuste: null, ...o,
});
const mov = (o: Partial<Movimento360>): Movimento360 => ({
  id: "m", tipo: "upsell", valor_delta: 10, data_movimento: "2026-01-10", encerrado_em: null, descricao: null, ...o,
});
const at = (o: Partial<Atendimento360>): Atendimento360 => ({
  id: "a", attendance_code: "AT-1", status: "closed", opened_at: "2026-09-10T13:00:00Z", closed_at: "2026-09-10T13:20:00Z",
  first_response_time_seconds: 120, handle_seconds: 1200, assigned_to: "u1", department_id: null, departamento: "Suporte",
  contact_name: "João", is_group: false, resolucao: "resolvido", ticket_id: null, ai_summary: null, ai_category: null,
  sentimento: null, conversation_id: "c1", csat_score: null, csat_reason: null, csat_respondido_em: null, ...o,
});
const tk = (o: Partial<Ticket360>): Ticket360 => ({
  id: "t", ticket_code: "TK-1", assunto: "Erro", aberto_em: "2026-09-01T12:00:00Z", concluido_em: null,
  status_nome: "Aberto", status_cor: null, status_final: false, categoria: "Fiscal", responsavel_user_id: null, ...o,
});

const SET = { from: new Date("2026-09-01T03:00:00Z"), to: new Date("2026-10-01T02:59:59Z") };

describe("mrrEm (espelho de fn_mrr_cliente_em)", () => {
  it("soma produto ativo e movimentos de saldo", () => {
    expect(mrrEm([prod({})], [mov({})], "2026-02-01")).toBe(110);
  });
  it("movimento depois da data não entra", () => {
    expect(mrrEm([prod({})], [mov({ data_movimento: "2026-03-01" })], "2026-02-01")).toBe(100);
  });
  it("movimento encerrado até a data sai do saldo", () => {
    expect(mrrEm([prod({})], [mov({ encerrado_em: "2026-01-31" })], "2026-02-01")).toBe(100);
    expect(mrrEm([prod({})], [mov({ encerrado_em: "2026-02-02" })], "2026-02-01")).toBe(110);
  });
  it("churn e reactivation são extrato, não saldo", () => {
    expect(mrrEm([prod({})], [mov({ tipo: "churn", valor_delta: -100 }), mov({ tipo: "reactivation", valor_delta: 100 })], "2026-02-01")).toBe(100);
  });
  it("produto cancelado conta até o dia do cancelamento", () => {
    const p = prod({ ativo: false, data_cancelamento: "2026-05-10" });
    expect(mrrEm([p], [], "2026-05-09")).toBe(100);
    expect(mrrEm([p], [], "2026-05-10")).toBe(0);
  });
  it("série tem 12 pontos e termina no valor de hoje", () => {
    const s = serieMrr12m([prod({})], [mov({ data_movimento: "2026-09-05" })], new Date("2026-09-25T15:00:00Z"));
    expect(s).toHaveLength(12);
    expect(s[11].valor).toBe(110);
    expect(s[10].valor).toBe(100);
  });
});

describe("números do período", () => {
  it("período anterior tem o mesmo tamanho e termina antes do início", () => {
    const a = periodoAnterior(SET);
    expect(a.to.getTime()).toBeLessThan(SET.from.getTime());
    expect(SET.to.getTime() - SET.from.getTime()).toBe(a.to.getTime() - a.from.getTime());
  });
  it("atendimentos: conta só os abertos no período e compara com o anterior", () => {
    const k = kpisAtendimento([at({}), at({ id: "b", opened_at: "2026-08-10T13:00:00Z" })], SET);
    expect(k.total).toBe(1);
    expect(k.totalAnterior).toBe(1);
    expect(k.primeiraRespostaSeg).toBe(120);
    expect(k.resolvidos).toBe(1);
  });
  it("CSAT: média e distribuição por nota", () => {
    const k = kpisCsat([at({ csat_score: 5 }), at({ id: "b", csat_score: 3 })], SET);
    expect(k.media).toBe(4);
    expect(k.dist.find((d) => d.nota === 5)?.qtd).toBe(1);
  });
  it("tickets: aberto independe do período", () => {
    const k = kpisTicket([tk({ aberto_em: "2025-01-01T12:00:00Z" }), tk({ id: "x", status_final: true, concluido_em: "2026-09-05T12:00:00Z" })], SET);
    expect(k.abertos).toBe(1);
    expect(k.concluidosNoPeriodo).toBe(1);
  });
});

describe("linha do tempo", () => {
  it("junta atendimento, avaliação, ticket e contrato, do mais novo ao mais velho", () => {
    const ev = montarLinhaDoTempo(
      [at({ csat_score: 2, csat_reason: "Demorou", csat_respondido_em: "2026-09-10T14:00:00Z" })],
      [tk({})],
      [mov({ data_movimento: "2026-09-20", valor_delta: 89 })],
      () => "Carla",
      SET,
    );
    expect(ev.map((e) => e.tipo)).toEqual(["contrato", "avaliacao", "atendimento", "ticket"]);
    const aval = ev.find((e) => e.tipo === "avaliacao")!;
    expect(aval.titulo).toBe("Avaliação 2 ★ para Carla");
    expect(aval.tags[0].texto).toBe("Detrator");
    expect(ev[0].detalhe).toContain("+ R$");
  });
  it("fora do período não aparece", () => {
    expect(montarLinhaDoTempo([at({ opened_at: "2025-01-01T12:00:00Z", closed_at: "2025-01-01T13:00:00Z" })], [], [], () => null, SET)).toHaveLength(0);
  });
});

describe("mapa de contato", () => {
  it("cobre ~53 semanas começando num domingo e conta por dia", () => {
    const dias = mapaDeContato([at({}), at({ id: "b" })], new Date("2026-09-25T15:00:00Z"));
    expect(dias.length).toBeGreaterThanOrEqual(364);
    expect(dias.length).toBeLessThanOrEqual(371);
    expect(dias.find((d) => d.dia === "2026-09-10")?.qtd).toBe(2);
  });
});

describe("tabela de atendimentos: funil e ordenação", () => {
  const lista = [
    at({ id: "1", attendance_code: "AT-9", contact_name: "Ana", csat_score: 5, handle_seconds: 600, opened_at: "2026-09-10T13:00:00Z", ai_category: "Fiscal" }),
    at({ id: "2", attendance_code: "AT-10", contact_name: "Bruno", csat_score: null, handle_seconds: 1800, opened_at: "2026-09-12T13:00:00Z", ai_category: "Relatórios" }),
    at({ id: "3", attendance_code: "AT-8", contact_name: "Álvaro", csat_score: 2, handle_seconds: 60, opened_at: "2026-09-11T13:00:00Z", ai_category: "Fiscal", status: "waiting" }),
  ];
  const nome = () => null;
  const ids = (r: { id: string }[]) => r.map((x) => x.id);

  it("Nº ordena pelo número, não pela letra (AT-8 < AT-9 < AT-10)", () => {
    expect(ids(filtrarOrdenarAtendimentos(lista, FILTROS_ATENDIMENTO_VAZIOS, { coluna: "codigo", dir: "asc" }, nome))).toEqual(["3", "1", "2"]);
    expect(ids(filtrarOrdenarAtendimentos(lista, FILTROS_ATENDIMENTO_VAZIOS, { coluna: "codigo", dir: "desc" }, nome))).toEqual(["2", "1", "3"]);
  });
  it("vazio vai para o fim nos dois sentidos", () => {
    expect(ids(filtrarOrdenarAtendimentos(lista, FILTROS_ATENDIMENTO_VAZIOS, { coluna: "csat", dir: "desc" }, nome))).toEqual(["1", "3", "2"]);
    expect(ids(filtrarOrdenarAtendimentos(lista, FILTROS_ATENDIMENTO_VAZIOS, { coluna: "csat", dir: "asc" }, nome))).toEqual(["3", "1", "2"]);
  });
  it("contato ignora acento e maiúscula", () => {
    const f = { ...FILTROS_ATENDIMENTO_VAZIOS, contato: "alva" };
    expect(ids(filtrarOrdenarAtendimentos(lista, f, { coluna: "aberto", dir: "desc" }, nome))).toEqual(["3"]);
  });
  it("funil de opções e faixa de duração", () => {
    const f = { ...FILTROS_ATENDIMENTO_VAZIOS, assunto: ["Fiscal"], duracao: { min: "5", max: "" } };
    expect(ids(filtrarOrdenarAtendimentos(lista, f, { coluna: "aberto", dir: "desc" }, nome))).toEqual(["1"]);
  });
  it("período por dia de São Paulo", () => {
    const f = { ...FILTROS_ATENDIMENTO_VAZIOS, aberto: { de: "2026-09-11", ate: "2026-09-12" } };
    expect(ids(filtrarOrdenarAtendimentos(lista, f, { coluna: "aberto", dir: "asc" }, nome))).toEqual(["3", "2"]);
  });
});
