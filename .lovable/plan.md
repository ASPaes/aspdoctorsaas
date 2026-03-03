

## Plano: KPIs de Conversão em Indicações + Nova Aba Oportunidades no Dashboard CS

### 1. Aba Indicações — Adicionar valores ganhos/perdidos e % conversão

**useCSDashboardData.ts**: Calcular novas métricas a partir dos tickets de indicação no período:
- `indicacoesGanhas`: count onde `indicacao_status = 'fechou'`
- `indicacoesPerdidas`: count onde `indicacao_status = 'nao_fechou'`
- `indicacoesConversaoPercent`: `ganhas / (ganhas + perdidas) * 100`

**CSDashboard.tsx** (aba Indicações): Adicionar 3 KPIs acima da tabela:
- **Ganhas** (variant success)
- **Perdidas** (variant danger)
- **% Conversão** (variant success/warning conforme valor)

### 2. Nova Aba "Oportunidades"

**useCSDashboardData.ts**: Calcular métricas de tickets `tipo = 'oportunidade'` no período:
- `oportunidadesAbertas`: backlog com tipo oportunidade
- `oportunidadesGanhas`: concluídas no período com `oport_resultado = 'ganho'`
- `oportunidadesPerdidas`: concluídas no período com `oport_resultado = 'perdido'`
- `oportunidadesConversaoPercent`: ganhas / (ganhas + perdidas)
- `oportunidadesValorPrevistoAtivacao`: soma `oport_valor_previsto_ativacao` do backlog
- `oportunidadesValorPrevistoMrr`: soma `oport_valor_previsto_mrr` do backlog
- `oportunidadesValorGanhoAtivacao`: soma dos ganhos no período
- `oportunidadesValorGanhoMrr`: soma dos ganhos no período
- Lista de oportunidades abertas para tabela

**CSDashboard.tsx**: Nova aba "Oportunidades" com:
- KPIs: Abertas, Ganhas, Perdidas, % Conversão
- KPIs financeiros: Previsão Ativação, Previsão MRR, Ganho Ativação, Ganho MRR
- Tabela de oportunidades abertas (cliente, valor previsto, data prevista, owner)

### Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `useCSDashboardData.ts` | Novas métricas de indicação (ganho/perda/conversão) + métricas de oportunidade |
| `CSDashboard.tsx` | KPIs de conversão na aba Indicações + nova aba Oportunidades com KPIs e tabela |

