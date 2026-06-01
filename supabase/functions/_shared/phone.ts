// Brazilian phone normalization (E.164-like with 55 prefix)
// Identifica fixo BR (1º dígito após DDD entre 2-5) via flag `isLandline`.
// NÃO adiciona o 9 em celulares antigos — números inbound são salvos exatamente
// como chegam do provedor (Evolution, Z-API, Meta Cloud).

export interface NormalizedPhone {
  phone: string;
  isGroup: boolean;
  isLandline: boolean;
}

export function normalizeBRPhone(raw: string): NormalizedPhone {
  if (!raw) return { phone: '', isGroup: false, isLandline: false };
  const isGroup = raw.includes('@g.us');

  let digits = raw
    .replace('@s.whatsapp.net', '')
    .replace('@g.us', '')
    .replace('@lid', '')
    .replace(/:\d+/, '')
    .replace(/\D/g, '')
    .replace(/^0+/, '');

  // Adiciona 55 se BR sem código de país
  if (!digits.startsWith('55') && digits.length >= 10 && digits.length <= 11) {
    digits = '55' + digits;
  }

  let isLandline = false;

  // Identifica fixo BR para informação semântica (isLandline).
  // NÃO modifica os dígitos — o número é preservado exatamente como veio do provedor.
  if (digits.startsWith('55') && digits.length === 12) {
    const firstDigit = digits[4];
    if (/[2-5]/.test(firstDigit)) {
      isLandline = true;
    }
  }

  return { phone: digits, isGroup, isLandline };
}

// Gera variantes (com e sem 9) para LOOKUPS em queries IN (...)
// IMPORTANTE: só gera variante "sem 9" se o número parece celular (não-fixo).
// Para números que aparentam ser fixos (após DDD começa com 2-5), NÃO gera variante.
export function phoneSearchVariants(phone: string): string[] {
  if (!phone || !phone.startsWith('55')) return [phone];
  const variants: string[] = [phone];

  if (phone.length === 13) {
    const afterDdd = phone.slice(4);
    // Só gera variante "sem 9" se o 2º dígito (que seria o início do número 8-dig)
    // for compatível com celular (6-9). Se for 2-5, é fixo "verdadeiro" — não tirar 9.
    const secondDigit = phone[5];
    if (/[6-9]/.test(secondDigit) && afterDdd.startsWith('9')) {
      variants.push(phone.slice(0, 4) + phone.slice(5));
    }
  } else if (phone.length === 12) {
    const firstDigit = phone[4];
    // Só gera variante "com 9" se o número parece celular antigo (6-9)
    if (/[6-9]/.test(firstDigit)) {
      variants.push(phone.slice(0, 4) + '9' + phone.slice(4));
    }
  }

  return variants;
}
