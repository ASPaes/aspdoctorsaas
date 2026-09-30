import { describe, expect, it } from "vitest";
import {
  alternarReacao, extrairMencoes, horaCurta, iniciais, previaDe, mesclarMensagem, montarLinhaDoTempo, presencaDe, type PaginasMsgs,
} from "./equipeUtils";
import type { Mensagem, Pessoa } from "./tipos";

const pessoa = (user_id: string, nome: string, extra: Partial<Pessoa> = {}): Pessoa => ({
  user_id, nome, cargo: null, role: "user", department_id: null, setor: null,
  presenca: "active", pausa: null, pausa_fim: null, atendimentos: 0, ultimo_sinal: null, ...extra,
});

const msg = (id: string, autor: string, created_at: string, extra: Partial<Mensagem> = {}): Mensagem => ({
  id, tenant_id: "t", canal_id: "c", autor_id: autor, parent_id: null, tipo: "texto", corpo: id,
  anexos: [], refs: [], mencoes: [], menciona_todos: false, reacoes: {}, respostas: 0,
  ultima_resposta_em: null, respondentes: [], editada_em: null, apagada_em: null, apagada_por: null,
  fixada_em: null, fixada_por: null, created_at, ...extra,
});

describe("extrairMencoes", () => {
  const pessoas = [pessoa("a", "Ana"), pessoa("ap", "Ana Paula"), pessoa("r", "Rafael Costa")];

  it("prefere o nome mais longo: @Ana Paula não vira @Ana", () => {
    expect(extrairMencoes("oi @Ana Paula, tudo bem?", pessoas).ids).toEqual(["ap"]);
  });

  it("acha as duas quando as duas aparecem", () => {
    expect(extrairMencoes("@Ana e @Ana Paula", pessoas).ids.sort()).toEqual(["a", "ap"]);
  });

  it("ignora maiúsculas e reconhece @todos", () => {
    const r = extrairMencoes("@rafael costa e @todos", pessoas);
    expect(r.ids).toEqual(["r"]);
    expect(r.todos).toBe(true);
  });

  it("e-mail não é menção a todos", () => {
    expect(extrairMencoes("manda pra suporte@todos.com.br", pessoas).todos).toBe(false);
  });
});

describe("montarLinhaDoTempo", () => {
  const agora = new Date("2026-09-29T15:00:00-03:00");

  it("agrupa mensagens seguidas do mesmo autor em até 5 min", () => {
    const itens = montarLinhaDoTempo([
      msg("1", "a", "2026-09-29T10:00:00-03:00"),
      msg("2", "a", "2026-09-29T10:02:00-03:00"),
      msg("3", "a", "2026-09-29T10:09:00-03:00"),
      msg("4", "b", "2026-09-29T10:09:30-03:00"),
    ], { agora });
    const m = itens.filter((i) => i.tipo === "msg") as Extract<typeof itens[number], { tipo: "msg" }>[];
    expect(m.map((i) => i.continuacao)).toEqual([false, true, false, false]);
  });

  it("põe divisória por dia no fuso de São Paulo", () => {
    const itens = montarLinhaDoTempo([
      msg("1", "a", "2026-09-28T23:30:00-03:00"), // 02:30 UTC do dia 29
      msg("2", "a", "2026-09-29T08:00:00-03:00"),
    ], { agora });
    expect(itens.filter((i) => i.tipo === "dia").map((i) => (i as { rotulo: string }).rotulo)).toEqual(["Ontem", "Hoje"]);
  });

  it("divisória de novas antes da primeira não lida de outra pessoa, e quebra o grupo", () => {
    const itens = montarLinhaDoTempo([
      msg("1", "b", "2026-09-29T10:00:00-03:00"),
      msg("2", "b", "2026-09-29T10:01:00-03:00"),
    ], { lidoAte: "2026-09-29T10:00:30-03:00", eu: "a", agora });
    expect(itens.map((i) => i.tipo)).toEqual(["dia", "msg", "novas", "msg"]);
    expect((itens[3] as { continuacao: boolean }).continuacao).toBe(false);
  });

  it("minha própria mensagem não abre a divisória", () => {
    const itens = montarLinhaDoTempo([msg("1", "a", "2026-09-29T10:00:00-03:00")], { lidoAte: "2026-09-29T09:00:00-03:00", eu: "a", agora });
    expect(itens.some((i) => i.tipo === "novas")).toBe(false);
  });
});

describe("mesclarMensagem", () => {
  const base: PaginasMsgs = { pages: [[msg("2", "a", "2026-09-29T10:02:00Z"), msg("1", "a", "2026-09-29T10:01:00Z")]], pageParams: [null] };

  it("otimista sai quando a real chega", () => {
    const comTemp = mesclarMensagem(base, msg("tmp-x", "a", "2026-09-29T10:03:00Z", { _pendente: true }))!;
    const final = mesclarMensagem(comTemp, msg("3", "a", "2026-09-29T10:03:01Z"), "tmp-x")!;
    expect(final.pages[0].map((m) => m.id)).toEqual(["3", "2", "1"]);
  });

  it("Realtime e resposta da RPC chegando os dois não duplicam", () => {
    const uma = mesclarMensagem(base, msg("3", "a", "2026-09-29T10:03:00Z"))!;
    const duas = mesclarMensagem(uma, msg("3", "a", "2026-09-29T10:03:00Z", { corpo: "editado" }))!;
    expect(duas.pages[0].filter((m) => m.id === "3")).toHaveLength(1);
    expect(duas.pages[0][0].corpo).toBe("editado");
  });

  it("sem cache carregado não inventa página", () => {
    expect(mesclarMensagem(undefined, msg("3", "a", "2026-09-29T10:03:00Z"))).toBeUndefined();
  });
});

describe("alternarReacao", () => {
  it("liga, soma e desliga removendo o emoji vazio", () => {
    let r = alternarReacao({}, "👍", "a");
    r = alternarReacao(r, "👍", "b");
    expect(r["👍"]).toEqual(["a", "b"]);
    r = alternarReacao(r, "👍", "a");
    r = alternarReacao(r, "👍", "b");
    expect(r).toEqual({});
  });
});

describe("horaCurta", () => {
  const agora = new Date("2026-09-29T15:00:00-03:00"); // terça
  it("hoje mostra a hora, ontem mostra ontem, semana mostra o dia", () => {
    expect(horaCurta("2026-09-29T09:05:00-03:00", agora)).toBe("09:05");
    expect(horaCurta("2026-09-28T23:59:00-03:00", agora)).toBe("ontem");
    expect(horaCurta("2026-09-27T10:00:00-03:00", agora)).toBe("dom");
    expect(horaCurta("2026-09-10T10:00:00-03:00", agora)).toBe("10/09");
  });
});

describe("presença e iniciais", () => {
  it("presença conta a operação real", () => {
    expect(presencaDe(pessoa("a", "A", { atendimentos: 3 })).texto).toBe("Em atendimento (3)");
    expect(presencaDe(pessoa("a", "A", { presenca: "paused", pausa: "Almoço" })).texto).toBe("Em pausa: Almoço");
    expect(presencaDe(undefined).tom).toBe("offline");
  });

  it("iniciais usam primeiro e último nome", () => {
    expect(iniciais("Ana Paula de Souza")).toBe("AS");
    expect(iniciais("Théo")).toBe("TH");
    expect(iniciais("")).toBe("?");
  });
});

describe("previaDe (igual à do banco)", () => {
  const base = { corpo: "", anexos: [], refs: [], apagada_em: null } as Parameters<typeof previaDe>[0];
  it("texto, apagada, imagem, arquivo e cartão", () => {
    expect(previaDe({ ...base, corpo: "linha 1\n  linha 2" })).toBe("linha 1 linha 2");
    expect(previaDe({ ...base, corpo: "x", apagada_em: "2026-09-29T10:00:00Z" })).toBe("Mensagem apagada");
    expect(previaDe({ ...base, anexos: [{ path: "p", nome: "a.png", mime: "image/png", tamanho: 1 }] })).toBe("Enviou uma imagem");
    expect(previaDe({ ...base, anexos: [{ path: "p", nome: "nota.pdf", mime: "application/pdf", tamanho: 1 }] })).toBe("Enviou nota.pdf");
    expect(previaDe({ ...base, refs: [{ tipo: "atendimento", id: "x" }] })).toBe("Pediu ajuda com um atendimento");
  });
});
