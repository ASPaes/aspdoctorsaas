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
 * Normalizes a Brazilian phone input to digits-only with 55 prefix.
 * Returns the normalized string (may be invalid — call isValidBRPhone to check).
 */
export function normalizeBRPhone(input: string): string {
  let digits = input.replace(/\D/g, "");

  // Remove leading zeros (e.g. 0xx style)
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
  if (!normalized) return "";

  const clean = normalized.replace(/\D/g, "");
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

  // Remove leading zeros
  digits = digits.replace(/^0+/, "");

  // Auto-prepend 55 if user typed 10+ digits without country code
  if (digits.length >= 10 && digits.length <= 11 && !digits.startsWith("55")) {
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
