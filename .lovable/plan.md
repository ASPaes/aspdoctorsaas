

## Plan: Módulo de Atendimentos do Chat WhatsApp — Pacote 1

### Overview

Implementar criação automática de atendimentos (`support_attendances`), filtragem por status de atendimento na sidebar, e auto-atribuição ao operador quando envia primeira mensagem. As tabelas já existem no Supabase.

### Changes

#### 1. Edge Function `evolution-webhook/index.ts` — Auto-criar atendimento

Na função `processMessageUpsert`, após salvar a mensagem e quando `isFromMe === false` (mensagem do cliente):

- Verificar se já existe `support_attendances` com `conversation_id` e `status != 'closed'`. Se sim, skip.
- Buscar `configuracoes.support_config` do tenant para obter `post_close_reopen_window_minutes` (default 5).
- Verificar se o último atendimento fechado tem `closed_at` dentro da janela. Se sim, skip.
- Se nenhuma condição bloqueia, criar registro em `support_attendances`:
  - `tenant_id`, `conversation_id`, `contact_id`, `status = 'waiting'`, `opened_at = now()`, `opened_by = null`
- Log no console para debug.

Nova função helper: `ensureAttendanceForIncomingMessage(supabase, conversationId, contactId, tenantId)`.

#### 2. Edge Function `send-whatsapp-message/index.ts` — Auto-atribuir ao enviar

Após enviar a mensagem com sucesso, verificar se existe `support_attendances` com `conversation_id`, `status = 'waiting'`, `assigned_to IS NULL`.

Se encontrar:
- Atualizar para `assigned_to = senderUserId`, `status = 'in_progress'`, `first_response_at = now()`.
- Log no console.

#### 3. Hook `useAttendanceStatus.ts` (novo)

Hook que consulta `support_attendances` para a conversa selecionada ou para todas as conversas listadas, retornando o status do atendimento ativo. Usado pela sidebar para enriquecer as conversas com dados de atendimento.

```typescript
// Busca atendimentos ativos (status != 'closed') para um conjunto de conversation_ids
// Retorna Map<conversationId, { status, assigned_to, id }>
```

#### 4. Sidebar `ConversationsSidebar.tsx` — Filtros de atendimento

Substituir os quick pills atuais por pills baseadas em atendimentos:

- **Todos** — todas conversas (admin vê tudo, técnico vê assigned_to = me OU unassigned)
- **Em andamento** — `support_attendances.status = 'in_progress'`
- **Fila** — `support_attendances.status = 'waiting'` e `assigned_to IS NULL`
- **Encerrados** — `support_attendances.status = 'closed'` (admin vê todos, técnico só os dele)

A filtragem será client-side: o hook busca os atendimentos ativos, e o `useMemo` do `filtered` aplica o filtro cruzando `conversation.id` com os dados do atendimento.

Para técnicos (non-admin), a regra de visibilidade existente (`assigned_to === user.id || assigned_to === null`) permanece, mas agora cruza com `support_attendances`:
- Conversa com atendimento `in_progress` e `assigned_to !== me` → oculta para técnico
- Conversa com atendimento `waiting` → visível na Fila

#### 5. `QuickPills.tsx` — Atualizar pills

Trocar pills para: Todos / Em andamento / Fila / Encerrados. Adicionar contagem para Fila (waiting count).

#### 6. `ConversationItem.tsx` — Badge de status

Adicionar um badge discreto (dot ou texto pequeno) no item da conversa indicando o status do atendimento (Aguardando / Em andamento). Reutilizar o componente Badge existente.

### Arquivos modificados

| Arquivo | Ação |
|---------|------|
| `supabase/functions/evolution-webhook/index.ts` | Adicionar `ensureAttendanceForIncomingMessage` + chamar em `processMessageUpsert` |
| `supabase/functions/send-whatsapp-message/index.ts` | Adicionar auto-atribuição após envio |
| `src/components/whatsapp/hooks/useAttendanceStatus.ts` | **Novo** — hook para consultar atendimentos ativos |
| `src/components/whatsapp/conversations/ConversationsSidebar.tsx` | Integrar filtros de atendimento |
| `src/components/whatsapp/conversations/QuickPills.tsx` | Trocar pills para status de atendimento |
| `src/components/whatsapp/conversations/ConversationItem.tsx` | Badge de status do atendimento |

### Segurança

- Webhook usa service role (já existente) — OK para criar atendimento server-side.
- Send-message já valida JWT e resolve `senderUserId` — auto-atribuição usa esse ID.
- Hook frontend consulta `support_attendances` via RLS (política `tenant_rw` já existe).
- Técnico só vê conversas com atendimentos dele ou na fila — filtro client-side + query-level.

