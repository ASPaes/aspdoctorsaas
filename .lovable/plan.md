

## Plan: Dashboard tab for Certificados A1

### Approach
Add a Tabs component to the `/certificados-a1` page with two tabs: "Lista" (current content) and "Dashboard". The Dashboard tab will have a DateRangePicker for period selection, KPI cards, and a bar chart for sales by employee.

### Steps

1. **Extend `useCertA1Data` hook** to also return:
   - `semDataQtd` — count of active clients with `cert_a1_vencimento IS NULL`
   - `vendasPorFuncionario` — array of `{ vendedor_id, vendedor_nome, qtd }` grouped from `certificado_a1_vendas` where status='ganho' in the period

2. **Create `src/components/certificados/CertA1Dashboard.tsx`**:
   - DateRangePicker (reusing existing component) for period filter
   - 7 KPI cards in a grid using `KPICardEnhanced`:
     - Vendas no Periodo (ganhos)
     - Perdidos (perdido_terceiro)
     - Faturamento (R$ sum of ganhos)
     - Oportunidades Janela (rolling, -20d to +30d)
     - Vencendo em 30d
     - Vencidos ate 20d
     - Sem Data
   - Bar chart (Recharts `BarChart`) for "Qtde de Vendas por Funcionario"

3. **Modify `src/pages/CertificadosA1.tsx`**:
   - Wrap content in `Tabs` with two `TabsContent`: "dashboard" and "lista"
   - Move existing table/filters into "lista" tab
   - Add `CertA1Dashboard` component in "dashboard" tab

### Data queries in extended hook
- `semDataQtd`: `supabase.from('clientes').select('id', { count: 'exact' }).eq('cancelado', false).is('cert_a1_vencimento', null)`
- `vendasPorFuncionario`: group the existing vendas query by `vendedor_id`, then join with `funcionarios` lookup for names

