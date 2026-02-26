

## Plan: Fix filters and add active filter badges

### Problem 1: Filters can't be cleared individually
All advanced Select filters (Recorrência, Modelo Contrato, Produto, Origem Venda, Área Atuação, Segmento, Funcionário, Fornecedor, Estado, Cidade, Motivo Cancelamento) are missing a "Todos/Todas" reset option. Once a value is selected, there's no way to go back — Radix Select requires a matching `SelectItem` for the current value. The `value=""` has no corresponding item.

### Problem 2: Estado filter display bug
When `estadoId === -1` (Nulo), the Select `value` is `"-1"` but the only matching item is `"__null__"`. This mismatch breaks display.

### Fix 1: Add "Todos/Todas" `SelectItem` to all filter Selects
Apply the same `__all__` pattern used in `unidadeBaseQuick`:
- Each Select gets `value={stateVar || "__all__"}` and `onValueChange={(v) => setState(v === "__all__" ? "" : v)}`
- Add `<SelectItem value="__all__">Todos</SelectItem>` as first option in each
- For Estado: unify to use string state instead of `number | null`, use `"__all__"` / `"__null__"` / id string

### Fix 2: Active filter badges
Add a row of small badges (chips) next to "Limpar filtros" showing each active filter with an X button to remove individually. These badges should be visible even when the advanced filters panel is collapsed.

**Badge definitions** (one per filter, shown only when active):
- Unidade Base, Recorrência, Modelo Contrato, Produto, Origem Venda, Área Atuação, Segmento, Funcionário, Fornecedor, Estado, Cidade, Motivo Cancelamento
- Date ranges (Cadastro, Cancelamento, Venda, Ativação)
- Numeric ranges (Mensalidade, Lucro, Margem)

Each badge shows the filter label + selected value name, and clicking X resets that single filter.

### Implementation (single file: `src/pages/Clientes.tsx`)

1. **Convert `estadoId` from `number | null` to `string`** — use `""` (all), `"__null__"` (null filter), or `"123"` (id). Update query builder accordingly.

2. **Add `__all__` SelectItem** to all 11 Select filters in the advanced section, and update their `value`/`onValueChange` to handle the `__all__` ↔ `""` mapping.

3. **Build `activeFilters` array** via `useMemo` — each entry has `{ key, label, value, onClear }`. Resolve display names from lookup data (e.g., produto name from `produtoMap`).

4. **Render badges** in a flex-wrap row between the collapsible trigger and the collapsible content, visible regardless of panel state. Use small `Badge` or `Button` components with an X icon.

