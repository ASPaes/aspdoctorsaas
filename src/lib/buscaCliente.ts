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
