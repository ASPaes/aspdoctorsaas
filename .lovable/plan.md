

## Objetivo
Trocar a coluna "Mensalidade" na lista de clientes para "MRR Atual", exibindo `mensalidade_base + soma dos deltas de movimentos MRR ativos` (mesmo cálculo já usado no Espelho Financeiro).

## Abordagem: Frontend-only (sem alterar view/migration)

### Mudanças em `src/pages/Clientes.tsx`

1. **Nova query paralela** — buscar movimentos MRR agrupados por `cliente_id`:
   - Query em `movimentos_mrr` com filtros: `status = 'ativo'`, `estornado_por IS NULL`, `estorno_de IS NULL`, `tipo != 'venda_avulsa'`
   - Agrupa no JS em um `Map<cliente_id, soma_valor_delta>`

2. **Mesclar no resultado** — para cada cliente na lista, calcular `mrr_atual = (mensalidade ?? 0) + (delta do map ?? 0)` e exibir na célula.

3. **Renomear header** — `"Mensalidade"` → `"MRR Atual"`.

4. **KPI Ticket Médio** — atualizar para usar `mrr_atual` em vez de `mensalidade` base.

5. **Sorting** — quando sortField = `"mensalidade"`, ordenar por `mrr_atual` calculado (no path client-side já funciona; no path server-side/view, o sort continua pela coluna `mensalidade` da view, que é uma limitação aceitável sem alterar a view).

6. **Filtro de Mensalidade** — o filtro de range `mensalidadeMin/Max` continuará filtrando pela `mensalidade` base no Supabase (limitação sem migration). O label do filtro será mantido como "Mensalidade R$" para distinguir.

### Arquivos
- `src/pages/Clientes.tsx` — única alteração

### Sem impacto em
- Dashboard, Espelho Financeiro, cálculos de lucro/margem
- Nenhuma migration ou alteração de view

