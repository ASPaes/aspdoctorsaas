

## Plan: Add "Nulo" (Null) filter option to lookup-based Select filters

### Scope
Add a "Nulo" option to every Select filter that references an auxiliary/lookup table, allowing users to find clients where that field is NULL. Date filters and numeric range filters are excluded per the user's request.

### Affected filters (8 total)
1. **Unidade Base** (quick filter) — `unidade_base_id`
2. **Recorrência** — `recorrencia`
3. **Modelo de Contrato** — `modelo_contrato_id`
4. **Produto** — `produto_id`
5. **Origem da Venda** — `origem_venda_id`
6. **Estado** — `estado_id`
7. **Cidade** — `cidade_id`
8. **Motivo Cancelamento** — `motivo_cancelamento_id`

### Implementation (single file: `src/pages/Clientes.tsx`)

1. **Add a `__null__` sentinel value** as a `<SelectItem>` labeled "Nulo" in each of the 8 Select components listed above, alongside the existing "Todos/Todas" option.

2. **Update the query builder** to apply `.is(field, null)` when the filter value is `"__null__"` instead of `.eq(field, value)`. Affects lines ~178 and ~194-199 where lookup filters are applied.

3. **Update `clearFilters`** — no change needed since clearing resets to `""` which skips both null and value filters.

### Example behavior
- `""` (default) → no filter applied (shows all)
- `"__null__"` → `.is('produto_id', null)` — shows only clients with no product
- `"5"` → `.eq('produto_id', 5)` — shows only clients with product id 5

