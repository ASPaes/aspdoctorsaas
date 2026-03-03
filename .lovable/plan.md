

## Plano: Filtro Global Unificado na Página Customer Success

### Situação Atual
Cada aba tem seus próprios filtros independentes:
- **Lista**: busca, status, prioridade, tipo
- **Kanban**: owner, prioridade
- **Painel**: sem filtros (status hardcoded)
- **Dashboard**: período, responsável

### O que muda
Criar uma barra de filtros única acima das abas (Painel/Kanban/Lista/Dashboard) com: **Busca**, **Status**, **Prioridade**, **Tipo**, **Período (DateRangePicker)** e **Responsável**. Todos os componentes filhos recebem os filtros via props.

### Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `CustomerSuccess.tsx` | Estado global dos filtros + barra de filtros + DateRangePicker acima das Tabs. Passa filtros como props para todos os filhos. |
| `CSTicketList.tsx` | Remove filtros internos. Recebe `filters` via props e usa no `useCSTickets`. |
| `CSKanban.tsx` | Remove filtros de owner/prioridade. Recebe `filters` via props e usa no `useCSTickets`. |
| `CSPanel.tsx` | Recebe `filters` via props. Combina com filtro de status ativo hardcoded. |
| `CSDashboard.tsx` | Remove card de filtros (período + responsável). Recebe `filters` via props e usa no `useCSDashboardData`. |

### Interface dos filtros globais

```typescript
interface CSGlobalFilters {
  search: string;
  status: CSTicketStatus | 'all';
  prioridade: CSTicketPrioridade | 'all';
  tipo: CSTicketTipo | 'all';
  periodoInicio: Date;
  periodoFim: Date;
  ownerId: string; // '__all__' ou id
}
```

### Layout da barra de filtros
Mesmo padrão visual da screenshot: busca + botão "Filtros" com badge de contagem + botão "Limpar". Ao expandir, mostra Status, Prioridade, Tipo em grid. Acima ou ao lado, DateRangePicker e Select de Responsável, sempre visíveis.

### Comportamento por aba
- **Painel**: Aplica filtros de prioridade, tipo, owner e período. Status do painel continua sendo apenas os "abertos" (intersecção com filtro global de status se selecionado).
- **Kanban**: Aplica todos os filtros. Remove filtros próprios de owner e prioridade.
- **Lista**: Aplica todos os filtros. Remove barra de busca e filtros próprios.
- **Dashboard**: Aplica período e owner dos filtros globais. Remove card de filtros próprio.

