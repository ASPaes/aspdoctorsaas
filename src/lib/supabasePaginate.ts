/**
 * Busca todas as linhas de uma query Supabase, paginando automaticamente.
 *
 * Por que existe: o PostgREST tem um teto global de linhas por resposta
 * (db-max-rows, padrão 1000 no Supabase). Usar `.limit(N)` no cliente não
 * sobrepõe esse teto — o servidor corta silenciosamente em 1000 linhas.
 * A paginação com `.range()` é a forma escalável de trazer todos os dados.
 *
 * Uso:
 *   const todos = await fetchAllRows<Cliente>(() =>
 *     supabase
 *       .from('vw_clientes_financeiro')
 *       .select('id, mensalidade, cancelado')
 *       .eq('tenant_id', tid)
 *       .lte('data_cadastro', periodoFimStr)
 *   );
 *
 * IMPORTANTE: passe uma FUNÇÃO que constrói a query, não a query pronta.
 * Isso garante que cada página começa de um builder fresh, evitando que
 * o `.range()` seja encadeado em cima de outro `.range()` acumulado.
 *
 * @param queryBuilder Função que retorna uma query Supabase já com filtros/select aplicados.
 * @param pageSize Tamanho do lote (default 1000, alinhado com o limite padrão do Supabase).
 * @returns Array concatenado com todas as linhas.
 */
export async function fetchAllRows<T = any>(
  queryBuilder: () => any,
  pageSize: number = 1000
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;

  // Safety cap para evitar loop infinito em cenário anômalo
  const MAX_PAGES = 50;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await queryBuilder().range(from, from + pageSize - 1);
    if (error) throw error;

    const chunk = (data || []) as T[];
    out.push(...chunk);

    // Se veio menos que pageSize, é a última página
    if (chunk.length < pageSize) return out;

    from += pageSize;
  }

  // Se atingiu MAX_PAGES sem esgotar, há algo muito errado — loga aviso e retorna o que tem
  console.warn(`[fetchAllRows] atingiu MAX_PAGES=${MAX_PAGES} (${MAX_PAGES * pageSize} linhas). Resultado pode estar truncado.`);
  return out;
}
