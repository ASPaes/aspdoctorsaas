/**
 * DEM-0103 — cor de destaque por usuário.
 *
 * O verde da marca (#22C55E) tem contraste 2,3:1 com o texto branco que roda em
 * cima dele (balão de mensagem enviada, pills, botões). WCAG 2.1 AA pede 4,5:1.
 * Em vez de trocar a cor de todo mundo, cada usuário escolhe a dele nas
 * Preferências — quem não escolher continua com o padrão.
 *
 * A troca acontece só no token `--primary` e derivados. `--primary-foreground`
 * continua branco de propósito: é por isso que toda cor selecionável precisa
 * passar em 4,5:1 contra branco (`MIN_CONTRAST`).
 */

/** Espelho local da preferência — pinta antes do React montar, sem piscar verde. */
export const ACCENT_STORAGE_KEY = "ds:accent-color";

/**
 * Cor da marca. Não é um preset: é o que sobra quando não há override.
 * Minúscula de propósito — o CHECK da coluna `theme_primary_color` exige
 * `^#[0-9a-f]{6}$`. Todo hex que sai daqui já vai no formato aceito.
 */
export const DEFAULT_ACCENT_HEX = "#22c55e";

/** WCAG 2.1 AA para texto normal. */
export const MIN_CONTRAST = 4.5;

/** Tokens repintados pelo override. Tudo lê `hsl(var(--…))` via Tailwind. */
const ACCENT_VARS = [
  "--primary",
  "--ring",
  "--sidebar-primary",
  "--sidebar-ring",
] as const;

/**
 * Variante clara do mesmo matiz, para quando a cor é o TEXTO em cima do fundo
 * escuro (`text-primary` no tema dark). Consumida por `--primary-text` no
 * index.css.
 */
const ACCENT_TEXT_VAR = "--primary-accessible";

/** Fundo do tema escuro (`--background` do `.dark`). */
const DARK_BG_HEX = "#0a0f14";

export interface AccentPreset {
  id: string;
  label: string;
  hex: string;
}

/** Todos passam em 4,5:1 contra branco — conferido pelo próprio `contrastWithWhite`. */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "verde-escuro", label: "Verde escuro", hex: "#15803d" },
  { id: "verde-floresta", label: "Verde floresta", hex: "#166534" },
  { id: "teal", label: "Teal", hex: "#0f766e" },
  { id: "azul", label: "Azul", hex: "#0369a1" },
  { id: "indigo", label: "Índigo", hex: "#4f46e5" },
  { id: "violeta", label: "Violeta", hex: "#7c3aed" },
  { id: "grafite", label: "Grafite", hex: "#334155" },
];

/* ─── conversão ─────────────────────────────────────────────────────────── */

function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export interface Hsl {
  /** 0-360 */ h: number;
  /** 0-100 */ s: number;
  /** 0-100 */ l: number;
}

export function hexToHsl(hex: string): Hsl {
  const [r255, g255, b255] = hexToRgb(hex);
  const r = r255 / 255;
  const g = g255 / 255;
  const b = b255 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h: h, s: s * 100, l: l * 100 };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const seg = Math.floor(((h % 360) + 360) % 360 / 60);
  const [r, g, b] = (
    [
      [c, x, 0],
      [x, c, 0],
      [0, c, x],
      [0, x, c],
      [x, 0, c],
      [c, 0, x],
    ] as const
  )[seg];
  const to255 = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${to255(r)}${to255(g)}${to255(b)}`;
}

/** `#15803D` → `"142 72% 29%"`, o formato que `hsl(var(--primary))` espera. */
export function hexToHslString(hex: string): string {
  const { h, s, l } = hexToHsl(hex);
  return `${Math.round(h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/** Aceita `#abc`, `abc`, `#AABBCC`. Devolve `#aabbcc` normalizado ou `null`. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, "");
  if (!/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw)) return null;
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return `#${full.toLowerCase()}`;
}

/* ─── contraste (WCAG 2.1) ──────────────────────────────────────────────── */

function channelLuminance(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** Razão de contraste contra branco puro — o texto que roda sobre a cor. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (relativeLuminance(hex) + 0.05);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Clareia o matiz até ele ler como TEXTO sobre o fundo do tema escuro. Sobe de
 * 1% em 1% em vez de usar um L fixo porque a luminância depende do matiz — um
 * azul precisa clarear bem mais que um verde para o mesmo contraste.
 */
export function accessibleOnDark(hex: string): string {
  const base = hexToHsl(hex);
  for (let l = Math.max(base.l, 40); l <= 85; l += 1) {
    const candidate = hslToHex({ ...base, l });
    if (contrastRatio(candidate, DARK_BG_HEX) >= MIN_CONTRAST) return candidate;
  }
  return hslToHex({ ...base, l: 85 });
}

export type ContrastLevel = "AAA" | "AA" | "AA-large" | "fail";

export function contrastLevel(ratio: number): ContrastLevel {
  if (ratio >= 7) return "AAA";
  if (ratio >= MIN_CONTRAST) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

export function formatContrast(ratio: number): string {
  return `${ratio.toFixed(1).replace(".", ",")}:1`;
}

/* ─── aplicação ─────────────────────────────────────────────────────────── */

/**
 * Escreve inline no `<html>`, o que vence tanto `:root` quanto `.dark` — a mesma
 * cor vale nos dois temas. `null` remove o override e devolve o verde da marca.
 */
export function applyAccentColor(hex: string | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;

  if (!hex) {
    ACCENT_VARS.forEach((v) => root.style.removeProperty(v));
    root.style.removeProperty(ACCENT_TEXT_VAR);
    return;
  }

  const normalized = normalizeHex(hex);
  if (!normalized) return;

  const hsl = hexToHslString(normalized);
  ACCENT_VARS.forEach((v) => root.style.setProperty(v, hsl));
  root.style.setProperty(ACCENT_TEXT_VAR, hexToHslString(accessibleOnDark(normalized)));
}

export function readStoredAccent(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return normalizeHex(localStorage.getItem(ACCENT_STORAGE_KEY) ?? "");
  } catch {
    return null;
  }
}

export function storeAccent(hex: string | null): void {
  if (typeof localStorage === "undefined") return;
  try {
    if (hex) localStorage.setItem(ACCENT_STORAGE_KEY, hex);
    else localStorage.removeItem(ACCENT_STORAGE_KEY);
  } catch {
    /* modo privado / storage cheio: a cor volta do banco no próximo load */
  }
}

/**
 * Pinta a cor salva antes do primeiro render. Sem isso o app monta verde e
 * troca de cor quando a query de preferências responde.
 */
export function bootstrapAccentColor(): void {
  applyAccentColor(readStoredAccent());
}
