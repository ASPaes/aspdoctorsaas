

## Objetivo
Adicionar KPI de "Tickets Abertos" na aba Indicações do CS Dashboard e alterar o cálculo de taxa de conversão para `ganhas / total de tickets` (em vez de `ganhas / (ganhas + perdidas)`).

## Mudanças

### 1. `src/components/cs/hooks/useCSDashboardData.ts`
- Adicionar campo `indicacoesTotalMovimentados: number` no retorno (total de tickets de indicação movimentados no período).
- Alterar cálculo de `indicacoesConversaoPercent`: de `ganhas / (ganhas + perdidas)` para `ganhas / totalMovimentados`.

### 2. `src/components/cs/CSDashboard.tsx` (aba Indicações, ~linhas 232-237)
- Trocar grid de 3 colunas para 4 colunas.
- Adicionar KPI "Tickets Abertos" (tipo indicação) antes dos demais.
- Os 4 KPIs ficam: **Abertas** | **Ganhas** | **Perdidas** | **% Conversão**.

### Sem impacto em
- Nenhuma outra aba ou componente.

