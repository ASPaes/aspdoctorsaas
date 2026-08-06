import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT_HEX,
  MIN_CONTRAST,
  accessibleOnDark,
  contrastRatio,
  contrastWithWhite,
  hexToHslString,
  hslToHex,
  normalizeHex,
} from "./accentColor";

const DARK_BG = "#0a0f14";

describe("conversão", () => {
  it("bate com o token do index.css", () => {
    // Se isto quebrar, o override pinta uma cor diferente da que o design define.
    expect(hexToHslString(DEFAULT_ACCENT_HEX)).toBe("142 71% 45%");
    expect(hexToHslString("#15803D")).toBe("142 72% 29%");
  });

  it("faz round-trip hex → hsl → hex dentro do erro de arredondamento", () => {
    // A string HSL usa inteiros (é o que vai para a CSS var), então volta com
    // até ~1/255 de diferença por canal. Invisível, mas não é identidade.
    const channels = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.replace("#", "").slice(i - 1, i + 1), 16));

    for (const p of ACCENT_PRESETS) {
      const [h, s, l] = hexToHslString(p.hex).replace(/%/g, "").split(" ").map(Number);
      const back = channels(hslToHex({ h, s, l }));
      channels(p.hex).forEach((c, i) => {
        expect(Math.abs(back[i] - c), `${p.label} canal ${i}`).toBeLessThanOrEqual(2);
      });
    }
  });

  it("todo hex embutido passa no CHECK da coluna theme_primary_color", () => {
    // `^#[0-9a-f]{6}$` — maiúscula quebra o INSERT em produção.
    const dbCheck = /^#[0-9a-f]{6}$/;
    expect(DEFAULT_ACCENT_HEX).toMatch(dbCheck);
    for (const p of ACCENT_PRESETS) expect(p.hex, p.label).toMatch(dbCheck);
  });

  it("normaliza entrada solta", () => {
    expect(normalizeHex("15803D")).toBe("#15803d");
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("verde")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
});

describe("contraste", () => {
  it("confirma o problema da DEM-0103 no verde padrão", () => {
    expect(contrastWithWhite(DEFAULT_ACCENT_HEX)).toBeLessThan(3);
  });

  it("todo preset passa em WCAG AA com texto branco", () => {
    for (const p of ACCENT_PRESETS) {
      expect(contrastWithWhite(p.hex), p.label).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });
});

describe("accessibleOnDark", () => {
  it("clareia até a cor servir como texto no tema escuro", () => {
    for (const p of ACCENT_PRESETS) {
      expect(contrastRatio(accessibleOnDark(p.hex), DARK_BG), p.label).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      );
    }
  });

  it("preserva o matiz", () => {
    const hue = (hex: string) => Number(hexToHslString(hex).split(" ")[0]);
    for (const p of ACCENT_PRESETS) {
      expect(Math.abs(hue(accessibleOnDark(p.hex)) - hue(p.hex)), p.label).toBeLessThanOrEqual(2);
    }
  });
});
