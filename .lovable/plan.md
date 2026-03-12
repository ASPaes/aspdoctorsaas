

## Diagnóstico

Após analisar o código, identifiquei os seguintes pontos:

**O que funciona**: A subscription Realtime da sidebar (`useWhatsAppConversations`) funciona porque **não usa filtro** — escuta todos os eventos de `whatsapp_conversations`.

**Provável causa raiz**: A subscription de mensagens (`useWhatsAppMessages`, linha 172) usa `filter: conversation_id=eq.${conversationId}`. O `REPLICA IDENTITY` da tabela `whatsapp_messages` está como `DEFAULT` (apenas PK). Embora INSERTs devam funcionar com qualquer replica identity, há relatos de comportamento inconsistente com filtros em Supabase Realtime quando o replica identity não é `FULL`. Além disso, não há fallback caso o canal falhe silenciosamente.

**Problemas adicionais**:
- Scroll sempre força ir ao fim em qualquer nova mensagem (sem smart scroll)
- Não existe indicador "Novas mensagens" quando o usuário está scrollado para cima
- Sem fallback de consistência caso o Realtime falhe

## Plano de Implementação

### 1. Migration SQL — Setar REPLICA IDENTITY FULL

```sql
ALTER TABLE public.whatsapp_messages REPLICA IDENTITY FULL;
```

Garante que Supabase Realtime tenha acesso a todas as colunas nas mudanças WAL, permitindo filtros confiáveis.

### 2. Reforçar `useWhatsAppMessages.ts`

- **Adicionar subscription sem filtro como fallback**: Além do canal filtrado por `conversation_id`, adicionar listener no canal de conversas para detectar quando `last_message_at` ou `updated_at` muda para a conversa aberta, e invalidar as mensagens (throttled a 2s).
- **Manter a lógica de `setQueryData`** para INSERT e UPDATE (dedupe por `id`/`message_id`, replace temp).
- **Adicionar log de debug** no subscribe callback (status do canal) para facilitar troubleshooting futuro.

### 3. Smart scroll em `ChatMessages.tsx`

- Calcular se o usuário está "perto do fim" (scroll position < 150px do bottom).
- Se sim: auto-scroll ao chegar nova mensagem.
- Se não: **não forçar scroll**; mostrar um botão flutuante "⬇ Novas mensagens" que ao clicar rola até o fim.
- Usar `useRef` para rastrear o container de scroll e `onScroll` para detectar posição.

### Arquivos alterados

1. **Migration SQL** — `ALTER TABLE whatsapp_messages REPLICA IDENTITY FULL`
2. **`src/components/whatsapp/hooks/useWhatsAppMessages.ts`** — Adicionar fallback de invalidação via conversas + logging
3. **`src/components/whatsapp/chat/ChatMessages.tsx`** — Smart scroll + botão "Novas mensagens"

### Como testar

1. Abrir conversa A na plataforma
2. Enviar mensagem do celular do cliente para a conversa A
3. Confirmar que a mensagem aparece instantaneamente (sem F5)
4. Scrollar para cima no chat, receber nova mensagem → deve aparecer botão "Novas mensagens" sem forçar scroll
5. Clicar no botão → rola até a mensagem nova
6. Verificar que status (sent/delivered/read) atualiza em tempo real

