export function isContactNameMissing(name: string, phoneNumber: string): boolean {
  if (!name || !phoneNumber) return false;
  if (name === phoneNumber) return true;
  const nn = name.replace(/\D/g, '');
  const np = phoneNumber.replace(/\D/g, '');
  return nn === np && nn.length > 0;
}
