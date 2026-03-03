

## Plano: Tabelas de Clientes Cancelados e Novos nas abas do Dashboard

### Objetivo
Adicionar uma tabela detalhada na aba **Cancelamentos** com a lista de clientes cancelados no período, e outra na aba **Vendas** com a lista de novos clientes, ambas abaixo dos gráficos já existentes.

---

### Alterações necessárias

#### 1. `src/components/dashboard/hooks/useDashboardData.ts`
- Expandir a query de **cancelamentos** (linha 78) para incluir: `razao_social, nome_fantasia, data_ativacao`
- Expandir a query de **novos clientes** (linha 62) para incluir: `razao_social, nome_fantasia, data_venda`
- Expor as listas `canceladosList` e `novosClientesList` no retorno do hook, enriquecidas com nomes de lookup (motivo cancelamento, funcionário/vendedor)
- Adicionar tipos para essas listas no retorno

#### 2. `src/components/dashboard/tabs/CancelamentosTab.tsx`
Adicionar ao final da aba (após os gráficos existentes) um card com tabela:

| Nome | Dias Ativo | Data Cancel. | Motivo | Vlr Mensal |
|------|-----------|-------------|--------|-----------|

- **Nome**: razao_social (com nome_fantasia em texto menor)
- **Dias Ativo**: diferença entre data_cancelamento e data_ativacao (ou data_cadastro)
- **Data Cancel.**: formatada dd/MM/yyyy
- **Motivo**: nome do motivo via lookup
- **Vlr Mensal**: mensalidade formatada como moeda
- Ordenada por data de cancelamento (mais recente primeiro)

#### 3. `src/components/dashboard/tabs/VendasTab.tsx`
Adicionar ao final da aba um card com tabela:

| Nome | Data Venda | Vendedor | Vlr Ativação | Vlr MRR |
|------|-----------|---------|-------------|---------|

- **Nome**: razao_social (com nome_fantasia em texto menor)
- **Data Venda**: data_cadastro formatada
- **Vendedor**: nome do funcionário via lookup
- **Vlr Ativação**: valor_ativacao formatada
- **Vlr MRR**: mensalidade formatada
- Ordenada por data de venda (mais recente primeiro)

#### 4. `src/components/dashboard/types.ts`
Adicionar interfaces `CanceladoListItem` e `NovoClienteListItem` para tipagem das listas.

---

### Dados adicionais úteis
- Na tabela de cancelados: badge colorido para **Early Churn** (≤90 dias)
- Na tabela de vendas: coluna **Origem** (origem_venda) como informação complementar
- Ambas tabelas com contagem total no título do card

### Sem breaking changes
Todas as alterações são aditivas — nenhuma funcionalidade existente será removida ou modificada.

