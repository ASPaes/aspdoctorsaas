

## Diagnóstico

### 1. Filtro de data do Dashboard CS com padrão errado ("2 dias")
O estado inicial do `periodo` em `CSDashboard.tsx` (linha 56-59) é:
```js
{ from: startOfMonth(new Date()), to: new Date() }
```
Como hoje é 2 de março, mostra apenas 1-2 de março. O correto para "mês corrente" é usar `endOfMonth(new Date())` como `to`.

### 2. Filtro de data não filtra os dados
O hook `useCSDashboardData` usa `isWithinInterval(parseISO(t.criado_em), interval)` com `interval = { start: filters.periodoInicio, end: filters.periodoFim }`. Quando o usuário seleciona uma data no DateRangePicker, o `to` vem como meia-noite (00:00:00) daquele dia. Qualquer ticket criado **durante** esse dia (ex: 15:30) fica fora do intervalo. A correção é aplicar `endOfDay()` no `periodoFim` dentro do hook de dados para garantir que o dia inteiro seja incluído.

### 3. Exclusão de tickets (admin)
O hook `useDeleteCSTicket` já existe em `useCSTickets.ts`, mas não há botão de excluir em nenhuma interface (nem na lista, nem no detalhe). Será adicionado um botão "Excluir" no dropdown de ações da lista (`CSTicketList`) e no detalhe (`CSTicketDetailContent`), com confirmação via AlertDialog.

---

## Plano de implementação

### Arquivo 1: `src/components/cs/CSDashboard.tsx`
- Mudar o `to` inicial do estado `periodo` de `new Date()` para `endOfMonth(new Date())`.

### Arquivo 2: `src/components/cs/hooks/useCSDashboardData.ts`
- Importar `endOfDay` de `date-fns`.
- No `queryFn`, aplicar `endOfDay(filters.periodoFim)` ao criar o `interval`, garantindo que tickets criados durante o último dia do período sejam incluídos.

### Arquivo 3: `src/components/cs/CSTicketList.tsx`
- Importar `useDeleteCSTicket` e `AlertDialog` (componentes de confirmação).
- Adicionar opção "Excluir" (com ícone `Trash2`) no DropdownMenu de cada ticket.
- Ao clicar, abrir confirmação: "Tem certeza que deseja excluir este ticket?".
- Ao confirmar, chamar `deleteTicket.mutateAsync(ticketId)`.

### Arquivo 4: `src/components/cs/CSTicketDetailContent.tsx`
- Adicionar botão "Excluir" na barra de ações do detalhe do ticket.
- Mesma lógica de confirmação com AlertDialog.
- Ao excluir com sucesso, fechar o detalhe (chamar `onClose`).

