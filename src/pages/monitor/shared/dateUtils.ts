export function parseBRDate(value: string): Date | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2));
  const month = parseInt(digits.slice(2, 4)) - 1;
  const year = parseInt(digits.slice(4, 8));
  const date = new Date(year, month, day);
  if (isNaN(date.getTime())) return null;
  if (date > new Date()) return null;
  return date;
}

export function formatBRDate(date: Date | undefined): string {
  if (!date) return '';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}
