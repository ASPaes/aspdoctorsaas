/**
 * Brazilian phone number utilities (E.164-like: 55 + DDD + number)
 * Stores as digits-only with 55 prefix, e.g. "5549999666019"
 */

/**
 * Normalizes a Brazilian phone input to digits-only with 55 prefix.
 * - Strips non-digits
 * - Removes leading zeros
 * - Prepends 55 if 10-11 digits without country code
 */
export function normalizeBRPhone(input: string): string {
  let digits = input.replace(/\D/g, "");

  // Remove leading zeros
  digits = digits.replace(/^0+/, "");

  // If 10-11 digits and doesn't start with 55, prepend 55
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
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
  if (!normalized || normalized.length < 4) return normalized;

  const clean = normalized.replace(/\D/g, "");
  if (!clean.startsWith("55") || clean.length < 12) return normalized;

  const ddd = clean.slice(2, 4);
  const number = clean.slice(4);

  if (number.length === 9) {
    return `+55 (${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  }
  if (number.length === 8) {
    return `+55 (${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }

  return `+55 (${ddd}) ${number}`;
}
