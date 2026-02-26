

## Plan: Add Despesas CAC to Configuracoes

Porting the CAC expenses feature from the reference project, adapted to use this project's multi-tenant architecture and the existing `unidades_base` table instead of hardcoded product/unit values.

### 1. Database Migration

Create `cac_despesas` table:
- `id` uuid PK (gen_random_uuid)
- `tenant_id` uuid (auto-set via trigger)
- `mes_inicial` date NOT NULL
- `mes_final` date NULL
- `ativo` boolean default true
- `categoria` text NOT NULL (marketing, custos_vendas, comissoes, salarios_diretos, salarios_parciais, ferramentas, outros_vendas)
- `descricao` text NOT NULL
- `valor_total` numeric NOT NULL
- `percentual_alocado_vendas` numeric NULL (only for salarios_parciais)
- `valor_alocado` numeric NOT NULL (auto-calculated)
- `unidade_base_id` bigint NULL (FK to `unidades_base.id`) -- replaces the hardcoded `produto_unidade`
- `created_at` timestamptz default now()

RLS policy: `tenant_id = current_tenant_id() OR is_super_admin()` for ALL.
Trigger: `set_tenant_id_on_insert`.

### 2. Create `src/components/configuracoes/CacDespesasTab.tsx`

Standalone component with:
- React Query for fetching `cac_despesas` (joined with `unidades_base` for display name)
- CRUD via mutations (insert/update/delete)
- Table with columns: Categoria, Descricao, Periodo, Valor Total, Valor Alocado, Unidade Base, Ativo (Switch), Acoes (edit/delete)
- Dialog for create/edit with fields:
  - mes_inicial (date input), mes_final (date input)
  - categoria (Select from static list)
  - descricao (text)
  - valor_total (numeric)
  - percentual_alocado_vendas (numeric, conditional on `salarios_parciais`)
  - unidade_base_id (Select from `unidades_base` lookup + "Geral" option)
  - ativo (Switch)
- `valor_alocado` auto-calculated: if salarios_parciais then `valor_total * percentual`, else `valor_total`

### 3. Update `src/pages/Configuracoes.tsx`

- Wrap existing content in `Tabs` with two tabs: "Percentuais" (existing card) and "Despesas CAC" (new component)
- Import and render `CacDespesasTab`

### Files
- **Create**: migration SQL
- **Create**: `src/components/configuracoes/CacDespesasTab.tsx`
- **Edit**: `src/pages/Configuracoes.tsx`

