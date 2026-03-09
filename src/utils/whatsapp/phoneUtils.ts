export function normalizeBrazilianPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13) return digits;
  if (digits.length >= 10 && digits.length <= 11) return `55${digits}`;
  return digits;
}

export function isValidBrazilianPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return (
    (digits.length >= 10 && digits.length <= 11) ||
    (digits.startsWith('55') && digits.length >= 12 && digits.length <= 13)
  );
}
