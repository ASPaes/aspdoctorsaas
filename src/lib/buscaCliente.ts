import { escapeLike } from "@/lib/utils";

/**
 * Termo de busca de cliente, normalizado do mesmo jeito que a coluna
 * `clientes.busca_nome` no banco: sem acento e em maiúscula.
 *
 * Os dois lados PRECISAM usar a mesma régua. Foi a falta disso que criou cadastro
 * duplicado em 11/09/2026: o cadastro do VARANDÃO BAR está gravado com "Ã", a busca
 * por "VARANDAO" não casava (`ILIKE` ignora maiúscula, não acento), e o cliente foi
 * cadastrado de novo — com duas implantações abertas ao mesmo tempo. 74 clientes só
 * da Digi Office têm acento no nome.
 *
 * Uso: `.ilike("busca_nome", `%${normalizarBuscaCliente(termo)}%`)`.
 * Do lado do banco quem normaliza é `public.f_unaccent(upper(termo))`.
 */
export function normalizarBuscaCliente(termo: string): string {
  return termo
    .normalize("NFD")
    // ̀-ͯ é o bloco dos acentos que o NFD separa da letra
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
}

/** O mesmo, já pronto para `.ilike` — evita esquecer os `%` de um dos lados. */
export function padraoBuscaCliente(termo: string): string {
  return `%${normalizarBuscaCliente(termo)}%`;
}

/**
 * Cláusula `.or(...)` da busca de cliente: nome (sem acento), CNPJ/CPF só pelos
 * dígitos e, quando o termo é número, o código. Usada pela lista de Clientes e
 * pela Visão 360°, para as duas acharem o mesmo cliente com o mesmo termo.
 */
export function filtroOrBuscaCliente(term: string): string {
  const trimmed = term.trim();
  const POSTGRES_INT_MAX = 2147483647;
  // busca_nome = nome fantasia + razao social, sem acento e em maiuscula (coluna
  // gerada). Sem ela, procurar "VARANDAO" nao achava o cadastro gravado "VARANDÃO"
  // — foi assim que nasceu um cliente duplicado em 11/09/2026.
  const parts = [
    `busca_nome.ilike.%${escapeLike(normalizarBuscaCliente(trimmed))}%`,
  ];
  // cnpj_digits = coluna gerada (só dígitos). Normaliza o termo pra dígitos e
  // compara — funciona digitando formatado OU não, independente de como o
  // cnpj original está gravado.
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 3) {
    parts.push(`cnpj_digits.ilike.%${digits}%`);
  }
  if (/^\d+$/.test(trimmed)) {
    const codigo = Number(trimmed);
    if (Number.isInteger(codigo) && codigo <= POSTGRES_INT_MAX) {
      parts.push(`codigo_sequencial.eq.${codigo}`);
    }
  }
  return parts.join(",");
}
