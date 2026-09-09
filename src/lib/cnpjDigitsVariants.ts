/**
 * Formas em que o mesmo documento pode estar gravado em `clientes.cnpj_digits`.
 *
 * A importação de jun/2026 zerou CPF à esquerda até 14 dígitos — o CPF
 * 374.105.258-27 virou `00037410525827` —, então comparar só pelo que foi
 * digitado deixaria o duplicado passar. É exatamente o caso que originou o
 * aviso de documento repetido no cadastro de cliente.
 */
export function cnpjDigitsVariants(digits: string): string[] {
  const semZeros = digits.replace(/^0+/, "");
  const candidatos = [digits, digits.padStart(14, "0"), semZeros];
  return Array.from(new Set(candidatos.filter((d) => d.length >= 11)));
}
