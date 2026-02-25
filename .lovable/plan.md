

# Plano: Aprimorar Drag-and-Drop no Kanban com Atualizacoes Automaticas

## Situacao Atual

O drag-and-drop ja esta implementado com `@hello-pangea/dnd`. Ao arrastar um card entre colunas, o status e atualizado no banco. Porem, faltam:

1. **Atualizacao otimista** -- o card pode "voltar" brevemente para a coluna original enquanto aguarda a resposta do servidor
2. **Campos automaticos** -- apenas `concluido_em` e preenchido; faltam outros campos relevantes
3. **Registro de historico** -- a mudanca de status nao gera um registro na timeline (`cs_ticket_updates`)

## Mudancas Propostas

### 1. Atualizacao otimista no cache do React Query

Ao arrastar, atualizar imediatamente o cache local (mover o card visualmente) antes da resposta do servidor. Se falhar, reverter ao estado anterior.

### 2. Campos automaticos por transicao de status

| Transicao | Campos atualizados automaticamente |
|---|---|
| `aberto` -> qualquer outro | `primeira_acao_em = now()` (se ainda nulo) |
| qualquer -> `concluido` | `concluido_em = now()` |
| qualquer -> `cancelado` | `concluido_em = now()` |
| qualquer mudanca | `atualizado_em = now()` (ja feito pelo banco) |

### 3. Registro automatico na timeline

Ao mudar status via drag, inserir um registro em `cs_ticket_updates` com:
- `tipo: 'mudanca_status'`
- `conteudo: "Status alterado de X para Y"`
- `privado: false`

### Arquivo modificado

| Arquivo | Mudanca |
|---|---|
| `src/components/cs/CSKanban.tsx` | Adicionar optimistic update no `handleDragEnd`; preencher `primeira_acao_em` automaticamente; inserir registro de timeline |
| `src/components/cs/hooks/useCSTickets.ts` | Adicionar `atualizado_em` no `UpdateTicketData` (opcional, banco ja faz) |

### Detalhe tecnico -- handleDragEnd aprimorado

```typescript
const handleDragEnd = async (result: DropResult) => {
  if (!result.destination || result.destination.droppableId === result.source.droppableId) return;

  const ticketId = result.draggableId;
  const oldStatus = result.source.droppableId as CSTicketStatus;
  const newStatus = result.destination.droppableId as CSTicketStatus;

  // 1. Optimistic update no cache
  queryClient.setQueryData(['cs-tickets', undefined], (old: CSTicket[] | undefined) => {
    if (!old) return old;
    return old.map(t => t.id === ticketId ? { ...t, status: newStatus } : t);
  });

  // 2. Montar campos automaticos
  const updates: UpdateTicketData = { id: ticketId, status: newStatus };
  const ticket = tickets?.find(t => t.id === ticketId);

  if (ticket && !ticket.primeira_acao_em && oldStatus === 'aberto') {
    updates.primeira_acao_em = new Date().toISOString();
  }
  if (newStatus === 'concluido' || newStatus === 'cancelado') {
    updates.concluido_em = new Date().toISOString();
  }

  try {
    await updateTicket.mutateAsync(updates);

    // 3. Registrar na timeline
    await supabase.from('cs_ticket_updates').insert({
      ticket_id: ticketId,
      tipo: 'mudanca_status',
      conteudo: `Status alterado de "${CS_TICKET_STATUS_LABELS[oldStatus]}" para "${CS_TICKET_STATUS_LABELS[newStatus]}"`,
      privado: false,
    });
  } catch {
    // Reverter optimistic update
    queryClient.invalidateQueries({ queryKey: ['cs-tickets'] });
  }
};
```

