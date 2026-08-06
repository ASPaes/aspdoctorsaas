/**
 * Brazilian phone number utilities (E.164-like: 55 + DDD + number)
 * Stores as digits-only with 55 prefix, e.g. "5549999666019"
 *
 * Test cases (manual):
 * - "(49) 9966-6019"      -> normalize: "5549966016019"? depends on digit count
 * - "4999666019"           -> normalize: "554999666019" (10 digits -> prepend 55 = 12 total)
 * - "49996660190"          -> normalize: "5549996660190" (11 digits -> prepend 55 = 13 total)
 * - "554199120714"         -> normalize: "554199120714" (already 55, 12 digits = valid)
 * - "+55 41 99120-0714"    -> normalize: "5541991200714" (13 digits = valid)
 * - "abc"                  -> normalize: "" -> invalid
 * - "123"                  -> normalize: "123" -> invalid (too short)
 */

/**
 * Números não-geográficos BR (0800/0300/0500/0900) — NÃO têm DDD.
 * Nacional: 0800 777 8134 · E.164: +55 800 777 8134 (o 0 é prefixo de discagem).
 * Núcleo = código de serviço (3) + 6 ou 7 dígitos.
 *
 * Não há ambiguidade com DDD: 30, 50, 80 e 90 não são DDDs válidos no Brasil,
 * então "55800…" só pode ser país 55 + 0800, nunca DDD + número.
 */
const NON_GEO_FULL = /^(300|500|800|900)\d{6,7}$/;

/**
 * Devolve o núcleo do não-geográfico (ex.: "8007778134") ou null.
 * Aceita a forma nacional ainda incompleta ("0800…") para máscara ao vivo;
 * as formas sem o 0 exigem o número completo para não confundir com DDD.
 */
export function nonGeoCoreBR(input: string): string | null {
  const d = input.replace(/\D/g, "");
  if (/^0(300|500|800|900)/.test(d)) return d.replace(/^0+/, "").slice(0, 10);
  if (NON_GEO_FULL.test(d)) return d;
  if (d.startsWith("55") && NON_GEO_FULL.test(d.slice(2))) return d.slice(2);
  return null;
}

/** Formata o núcleo do não-geográfico no padrão nacional: 0800 777 8134 */
function formatNonGeoBR(core: string): string {
  const rest = core.slice(3);
  if (!rest) return `0${core}`;
  if (rest.length <= 3) return `0${core.slice(0, 3)} ${rest}`;
  return `0${core.slice(0, 3)} ${rest.slice(0, 3)} ${rest.slice(3)}`;
}

/**
 * Normalizes a Brazilian phone input to digits-only with 55 prefix.
 * Returns the normalized string (may be invalid — call isValidBRPhone to check).
 */
export function normalizeBRPhone(input: string): string {
  let digits = input.replace(/\D/g, "");

  // 0800/0300/0500/0900: sem DDD, o 0 cai e o 55 entra na frente.
  const nonGeo = nonGeoCoreBR(digits);
  if (nonGeo) return "55" + nonGeo;

  // Remove leading zeros (e.g. 0xx style)
  digits = digits.replace(/^0+/, "");

  // 10-11 dígitos = número nacional (DDD + 8/9 dígitos), SEM código de país.
  // Sempre prefixa 55 — inclusive quando o DDD é 55 (RS: Santa Maria/região central).
  // Um número COM código de país tem 12-13 dígitos, nunca 10-11, então o comprimento
  // desambigua: não dá pra confundir o DDD 55 com o código de país aqui.
  if (digits.length >= 10 && digits.length <= 11) {
    digits = "55" + digits;
  }

  return digits;
}

/**
 * Validates a normalized BR phone (digits-only, already with 55 prefix).
 * Must be 12 or 13 digits: 55 + DDD(2) + number(8 or 9)
 */
export function isValidBRPhone(normalized: string): boolean {
  if (!/^\d+$/.test(normalized)) return false;
  if (!normalized.startsWith("55")) return false;

  // 0800/0300/0500/0900: 55 + 3 + (6 ou 7) = 11 ou 12 dígitos, sem DDD.
  if (NON_GEO_FULL.test(normalized.slice(2))) return true;

  if (normalized.length !== 12 && normalized.length !== 13) return false;

  const ddd = normalized.slice(2, 4);
  if (ddd === "00") return false;

  return true;
}

/**
 * Formats a normalized BR phone (digits with 55) for display.
 * Returns: +55 (DD) NNNNN-NNNN or +55 (DD) NNNN-NNNN
 */
export function formatBRPhone(normalized: string): string {
  if (!normalized) return "";

  const clean = normalized.replace(/\D/g, "");

  const nonGeo = nonGeoCoreBR(clean);
  if (nonGeo) return formatNonGeoBR(nonGeo);

  if (clean.length < 4) return clean;
  if (!clean.startsWith("55")) return clean;

  const ddd = clean.slice(2, 4);
  const number = clean.slice(4);

  if (number.length === 9) {
    return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  }
  if (number.length === 8) {
    return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }

  // Partial or incomplete — still format what we can
  if (number.length > 0) {
    return `+55 (${ddd}) ${number}`;
  }
  return `+55 (${ddd})`;
}

/**
 * Returns "core" digits (without 55 prefix) for comparison purposes.
 * Normalizes first, then strips leading 55.
 */
export function coreDigits(input: string): string {
  const normalized = normalizeBRPhone(input);
  return normalized.startsWith("55") ? normalized.slice(2) : normalized;
}

/** Alias for backward compatibility */
export const normalizePhoneDigits = normalizeBRPhone;
/** Alias for backward compatibility */
export const formatBrazilPhone = formatBRPhone;

/**
 * Applies live mask to phone input as the user types.
 * Returns the masked display string. Max 13 digits (55 + DDD + 9-digit number).
 */
export function maskBRPhoneLive(input: string): string {
  let digits = input.replace(/\D/g, "");

  // 0800/0300/0500/0900: sem DDD — formato nacional, o 0 fica visível.
  const nonGeo = nonGeoCoreBR(digits);
  if (nonGeo) return formatNonGeoBR(nonGeo);

  // "0", "08", "080" — ainda pode virar 0800/0300/…; preserva enquanto digita.
  if (/^0\d{0,2}$/.test(digits)) return digits;

  // Remove leading zeros
  digits = digits.replace(/^0+/, "");

  // Auto-prepend 55 quando o usuário digitou um número nacional (10-11 dígitos),
  // inclusive com DDD 55 — igual a normalizeBRPhone. Com código de país são 12-13.
  if (digits.length >= 10 && digits.length <= 11) {
    digits = "55" + digits;
  }

  // Cap at 13 digits
  digits = digits.slice(0, 13);

  if (digits.length === 0) return "";
  if (digits.length <= 2) return `+${digits}`;
  if (digits.length <= 4) return `+${digits.slice(0, 2)} (${digits.slice(2)}`;
  if (digits.length <= 8) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4)}`;
  }
  if (digits.length <= 12) {
    // 8-digit number (fixo): XXXX-XXXX
    const num = digits.slice(4);
    if (num.length <= 4) {
      return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${num}`;
    }
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${num.slice(0, 4)}-${num.slice(4)}`;
  }
  // 13 digits: 9-digit number (celular): XXXXX-XXXX
  const num = digits.slice(4);
  return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${num.slice(0, 5)}-${num.slice(5)}`;
}
