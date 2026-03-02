

## Plano: Regras de Negócio por Tipo de Ticket CS (7 Itens)

### Fase 1 — Migração SQL

Adicionar 5 colunas em `cs_tickets`:

| Coluna | Tipo | Uso |
|--------|------|-----|
| `contato_externo_nome` | text, nullable | Item 7 — nome do contato externo em tickets internos |
| `oport_valor_previsto_ativacao` | numeric, default 0 | Item 3 — valor de ativação previsto |
| `oport_valor_previsto_mrr` | numeric, default 0 | Item 3 — valor de MRR mensal previsto |
| `oport_data_prevista` | date, nullable | Item 3 — data prevista de fechamento |
| `oport_resultado` | text, nullable | Item 3 — 'ganho' ou 'perdido' |

O campo `mrr_recuperado` já existe na tabela. Os campos `oport_valor_ganho_*` não são necessários como colunas separadas — ao marcar como "ganho", o usuário abre manualmente o Movimento MRR para registrar.

---

### Fase 2 — types.ts + useCSTickets.ts

- Adicionar ao tipo `CSTicket`: `contato_externo_nome`, `oport_valor_previsto_ativacao`, `oport_valor_previsto_mrr`, `oport_data_prevista`, `oport_resultado`.
- Adicionar esses campos aos tipos `CreateTicketData` e `UpdateTicketData`.

---

### Fase 3 — Item 1: Risco de Churn — MRR Recuperado editável

**CSTicketDetailContent.tsx**:
- **Modo edit**: Quando `tipo = risco_churn`, exibir campo `mrr_recuperado` editável ao lado de `mrr_em_risco`. Incluir no `handleSave`.
- **Diálogo Concluir**: Quando `tipo = risco_churn`, exibir campo "MRR Recuperado (R$)" antes de confirmar.

---

### Fase 4 — Item 2: Lista detalhada de Indicações no Dashboard

**CSDashboard.tsx** (aba Indicações):
- Abaixo dos KPIs de pipeline, adicionar tabela com colunas: Nome Indicado, Contato, Cidade, Status, Cliente que indicou, Owner, Data.

**useCSDashboardData.ts**:
- Expor `ticketsIndicacaoDetalhados` — já temos os tickets filtrados, apenas retornar a lista completa.

---

### Fase 5 — Item 3: Oportunidade de Venda

**CSTicketForm.tsx**:
- Quando `tipo = oportunidade`: exibir seção "Oportunidade de Venda" com `oport_valor_previsto_ativacao`, `oport_valor_previsto_mrr` e `oport_data_prevista`. Remover o campo `mrr_em_risco` para este tipo.

**CSTicketDetailContent.tsx**:
- **Modo view**: Card mostrando Valor Previsto (Ativação + MRR), Data Prevista, Resultado.
- **Modo edit**: Editar valores previstos e data prevista.
- **Diálogo Concluir** (tipo oportunidade): Escolher "Ganho / Perdido".
  - Se **Ganho**: Atualizar ticket com `oport_resultado = 'ganho'`. Exibir botão "Abrir Movimentos MRR" que navega para `/clientes/{cliente_id}` (aba movimentos) para registro manual.
  - Se **Perdido**: Fechar com `oport_resultado = 'perdido'`.

**CSDashboard.tsx**:
- Nova aba "Oportunidades" com KPIs: Previsão Ativação, Previsão MRR, Ganhos, Perdidos, Taxa de Conversão.
- Tabela de oportunidades abertas.

**useCSDashboardData.ts**: Calcular métricas de oportunidade.

---

### Fase 6 — Itens 4 e 5: Relacionamento 90D + Adoção/Engajamento

**useCSDashboardData.ts**:
- Buscar todos clientes ativos (`cancelado = false`).
- Cruzar com tickets `relacionamento_90d` / `adocao_engajamento` abertos ou concluídos nos últimos 90 dias.
- Calcular: "Concluídos no período" e "Clientes sem contato (sem ticket em 90 dias)".

**CSDashboard.tsx**:
- Nova aba "Relacionamento" com KPIs (concluídos, pendentes, % cobertura) e tabela de clientes sem contato.

---

### Fase 7 — Item 6: Clube/Comunidade

**CSTicketForm.tsx**: Quando `tipo = clube_comunidade`, renomear "Próxima Ação" → "Ação Agendada/Realizada".

**CSDashboard.tsx** (aba Operação): Contagem de ações registradas vs agendadas no período.

---

### Fase 8 — Item 7: Interno/Processo com contato externo

**CSTicketForm.tsx**: Quando `tipo = interno_processo`, exibir campo "Nome do Contato Externo".

**CSTicketDetailContent.tsx**: Exibir e editar o campo. Quando preenchido, seguir mesma lógica visual de oportunidade (campos de previsão de venda externa), mas sem inserção automática em `movimentos_mrr`.

---

### Resumo de arquivos

| Arquivo | Mudanças |
|---------|----------|
| Migração SQL | 5 colunas novas |
| `types.ts` | Campos novos no tipo CSTicket |
| `useCSTickets.ts` | Campos nos tipos Create/Update |
| `CSTicketForm.tsx` | Seções condicionais por tipo |
| `CSTicketDetailContent.tsx` | MRR recuperado editável, seção oportunidade, contato externo, botão Mov. MRR |
| `useCSDashboardData.ts` | Métricas oportunidade, clientes sem contato 90d, ações clube |
| `CSDashboard.tsx` | Abas Oportunidades e Relacionamento; lista indicações; ações clube |

### Implementação

Devido ao tamanho, sugiro 3 rodadas:
1. **Rodada 1**: SQL + types + Itens 1, 2, 7 (menores)
2. **Rodada 2**: Item 3 (oportunidade completa com dashboard) + Item 6 (clube)
3. **Rodada 3**: Itens 4 e 5 (clientes sem contato 90d)

