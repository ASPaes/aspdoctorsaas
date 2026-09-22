import { describe, it, expect } from "vitest";
import { buildLines, chunkLines, fmtBR, maxTokensFor, parseSections, sectionsForMerge, type RawMessage } from "./core.ts";

const base: Omit<RawMessage, "id" | "timestamp"> = {
  content: null, message_type: "text", is_from_me: false, sender_name: null,
  sent_by_user_id: null, audio_transcription: null, media_filename: null, deleted_at: null,
};
const msg = (id: string, ts: string, over: Partial<RawMessage>): RawMessage => ({ ...base, id, timestamp: ts, ...over });

describe("fmtBR", () => {
  it("converte UTC para horario de Brasilia", () => {
    expect(fmtBR("2026-09-18T11:03:00Z")).toBe("18/09 08:03");
    expect(fmtBR("2026-09-18T02:10:00Z")).toBe("17/09 23:10");
  });
});

describe("buildLines", () => {
  const staff = new Map([["u-ana", "Ana"]]);

  it("numera, identifica quem falou e ignora o que nao tem conteudo", () => {
    const lines = buildLines([
      msg("1", "2026-09-17T12:12:00Z", { content: "Falta a impressora", sender_name: "Marcos" }),
      msg("2", "2026-09-17T12:13:00Z", { message_type: "reaction", content: "👍", sender_name: "Marcos" }),
      msg("3", "2026-09-17T12:14:00Z", { content: "Treino às 14h", is_from_me: true, sent_by_user_id: "u-ana" }),
      msg("4", "2026-09-17T12:15:00Z", { content: "apagada", deleted_at: "2026-09-17T12:16:00Z" }),
      msg("5", "2026-09-17T12:16:00Z", { message_type: "image", content: "" }),
      msg("6", "2026-09-17T12:17:00Z", { content: "enviado do celular", is_from_me: true }),
    ], staff);

    expect(lines.map((l) => l.text)).toEqual([
      "#1 [17/09 09:12] Marcos (cliente): Falta a impressora",
      "#2 [17/09 09:14] Ana (equipe): Treino às 14h",
      "#3 [17/09 09:17] Equipe (equipe): enviado do celular",
    ]);
    expect(lines.map((l) => l.id)).toEqual(["1", "3", "6"]);
  });

  it("usa a transcricao do audio e avisa quando nao ha", () => {
    const lines = buildLines([
      msg("a", "2026-09-17T12:00:00Z", { message_type: "audio", audio_transcription: "começando o treino" }),
      msg("b", "2026-09-17T12:01:00Z", { message_type: "audio" }),
      msg("c", "2026-09-17T12:02:00Z", { message_type: "document", media_filename: "precos.xlsx" }),
    ], new Map());
    expect(lines.map((l) => l.text.split(": ")[1])).toEqual([
      "[áudio] começando o treino",
      "[áudio sem transcrição]",
      "[documento precos.xlsx]",
    ]);
  });
});

describe("chunkLines", () => {
  it("nao quebra mensagem no meio e respeita o tamanho", () => {
    const lines = buildLines(
      Array.from({ length: 10 }, (_, i) => msg(String(i), "2026-09-17T12:00:00Z", { content: "x".repeat(40), sender_name: "A" })),
      new Map(),
    );
    const parts = chunkLines(lines, 200);
    expect(parts.flat().length).toBe(10);
    for (const p of parts) expect(p.map((l) => l.text.length + 1).reduce((a, b) => a + b)).toBeLessThanOrEqual(200);
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe("parseSections", () => {
  const lines = buildLines([
    msg("m1", "2026-09-18T11:03:00Z", { content: "tabela nova na segunda", sender_name: "Marcos" }),
  ], new Map());
  const byRef = new Map(lines.map((l) => [l.ref, l]));

  it("troca ref pela hora e id reais; ref inventado vira item sem origem", () => {
    const s = parseSections(JSON.stringify({
      decisoes: [{ texto: "Tabela nova vale na segunda", ref: 1 }],
      proximos_passos: [{ texto: "Importar", ref: 99 }, { texto: "  ", ref: 1 }],
    }), byRef);
    expect(s.decisoes).toEqual([{ texto: "Tabela nova vale na segunda", msg_at: "2026-09-18T11:03:00Z", message_id: "m1" }]);
    expect(s.proximos_passos).toEqual([{ texto: "Importar", msg_at: null, message_id: null }]);
    expect(s.treinamentos).toEqual([]);
  });

  it("aceita JSON cercado de texto e lista de strings", () => {
    const s = parseSections('Aqui está:\n```json\n{"duvidas":["Desconto por item? Sim."]}\n```', byRef);
    expect(s.duvidas[0].texto).toBe("Desconto por item? Sim.");
  });

  it("recusa resposta sem JSON", () => {
    expect(() => parseSections("não consegui", byRef)).toThrow(/formato esperado/);
  });

  it("consolidacao devolve o ref original de cada item", () => {
    const part = parseSections(JSON.stringify({ decisoes: [{ texto: "d", ref: 1 }] }), byRef);
    expect(JSON.parse(sectionsForMerge([part], lines)).decisoes).toEqual([{ texto: "d", ref: 1 }]);
  });
});

describe("maxTokensFor", () => {
  it("da folga ao modelo que gasta o teto raciocinando", () => {
    expect(maxTokensFor("gpt-5-mini")).toBe(16_000);
    expect(maxTokensFor("gpt-5.4")).toBe(16_000);
    expect(maxTokensFor("o3-mini")).toBe(16_000);
  });

  it("mantem 4000 no resto, que e o teto de saida de varios modelos", () => {
    expect(maxTokensFor("gpt-4o")).toBe(4000);
    expect(maxTokensFor("claude-3-5-haiku")).toBe(4000);
    expect(maxTokensFor("gemini-2.0-flash")).toBe(4000);
    expect(maxTokensFor("")).toBe(4000);
  });
});
