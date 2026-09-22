import { describe, it, expect } from "vitest";
import { DEFAULT_TONE, resolveRepeat, resolveTone } from "./tones";

/**
 * O formato salvo em `user_preferences.sound_by_event` mudou quando o toque
 * contínuo entrou: o valor do evento passou a poder ser objeto. Quem salvou
 * antes tem texto puro gravado no banco, e não existe migração de dado — então
 * ler os dois formatos é requisito, não conveniência.
 */
describe("resolveTone / resolveRepeat", () => {
  it("cai no padrão do evento quando não há nada salvo", () => {
    expect(resolveTone("queue", null)).toBe(DEFAULT_TONE.queue);
    expect(resolveTone("message", {})).toBe(DEFAULT_TONE.message);
    expect(resolveRepeat("queue", null)).toBe(false);
  });

  it("lê o formato antigo, só com o toque", () => {
    expect(resolveTone("group", { group: "grave" })).toBe("grave");
    expect(resolveRepeat("group", { group: "grave" })).toBe(false);
  });

  it("lê o formato novo, com repetir", () => {
    const map = { queue: { toque: "tripla", repetir: true } };
    expect(resolveTone("queue", map)).toBe("tripla");
    expect(resolveRepeat("queue", map)).toBe(true);
  });

  it("repetir no toque padrão não perde o padrão do evento", () => {
    const map = { queue: { repetir: true } };
    expect(resolveTone("queue", map)).toBe(DEFAULT_TONE.queue);
    expect(resolveRepeat("queue", map)).toBe(true);
  });

  it("ignora toque que não existe no catálogo", () => {
    expect(resolveTone("message", { message: "sirene-que-nao-existe" })).toBe(
      DEFAULT_TONE.message
    );
    expect(resolveTone("message", { message: { toque: "nada" } })).toBe(
      DEFAULT_TONE.message
    );
  });
});
