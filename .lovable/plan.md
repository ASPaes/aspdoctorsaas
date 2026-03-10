

## Plano: Apagar mensagens + Encaminhar mensagens

**Componente alvo:** `src/components/whatsapp/chat/ChatMessages.tsx`, `MessageBubble.tsx`, `ChatAreaFull.tsx`

---

### 1. Edge Function: `delete-whatsapp-message`

Nova edge function que:
- Recebe `{ messageIds: string[], conversationId: string }` (suporta batch)
- Valida JWT e que o usuário é o remetente (`is_from_me = true`, `sent_by_user_id` = user)
- Valida limite de 5 minutos por mensagem (`now - timestamp <= 5min`)
- Chama Evolution API `DELETE /chat/deleteMessageForEveryone/{instance}` para cada mensagem com `{ id, remoteJid, fromMe: true }`
- Marca mensagens no banco como `status = 'deleted'` (soft delete) ao invés de remover fisicamente
- Registrar em `supabase/config.toml`

### 2. Edge Function: `forward-whatsapp-message`

Nova edge function que:
- Recebe `{ messageIds: string[], targetConversationId: string }` 
- Para cada mensagem, re-envia o conteúdo para o contato da conversa destino:
  - **Texto**: envia via `sendText` com prefixo "↪ Encaminhado"
  - **Mídia (imagem/audio/video/doc)**: busca `media_path` do storage, gera signed URL, envia via endpoint apropriado da Evolution API
- Salva as novas mensagens na conversa destino
- Registrar em `supabase/config.toml`

### 3. Frontend: Modo de seleção de mensagens

**Em `ChatAreaFull.tsx`:**
- Novo state: `selectionMode: boolean`, `selectedMessages: Set<string>`
- Barra de ações flutuante (bottom bar) quando `selectionMode = true` com botões: "Apagar ({n})", "Encaminhar ({n})", "Cancelar"
- O botão "Apagar" só fica habilitado se TODAS as selecionadas são `is_from_me` e dentro de 5 min

**Em `MessageBubble.tsx`:**
- Receber props: `selectionMode`, `isSelected`, `onToggleSelect`, `canDelete` (calculado: is_from_me && < 5min)
- Em modo seleção: checkbox à esquerda de cada bolha
- Fora do modo seleção: menu de contexto (long press ou hover) com opções:
  - "Apagar" (só se `is_from_me` && < 5min)
  - "Encaminhar"
  - "Selecionar" (entra no modo seleção)
- Mensagens deletadas (`status === 'deleted'`) renderizam como "🚫 Mensagem apagada" em itálico

**Em `ChatMessages.tsx`:**
- Passar props de seleção para cada `MessageBubble`
- Filtrar ou estilizar mensagens com `status === 'deleted'`

### 4. Dialog de encaminhar

**Novo componente `ForwardMessageDialog.tsx`:**
- Modal com lista de conversas do hook `useConversations` existente
- Campo de busca para filtrar por nome/telefone
- Ao selecionar conversa destino, chama a edge function `forward-whatsapp-message`
- Toast de sucesso/erro

### 5. Hooks novos

- `useDeleteMessages`: mutation que chama `delete-whatsapp-message`, invalida cache de mensagens
- `useForwardMessages`: mutation que chama `forward-whatsapp-message`, invalida cache

### 6. Resumo de arquivos

| Ação | Arquivo |
|------|---------|
| Criar | `supabase/functions/delete-whatsapp-message/index.ts` |
| Criar | `supabase/functions/forward-whatsapp-message/index.ts` |
| Editar | `supabase/config.toml` (2 novas entries) |
| Criar | `src/components/whatsapp/hooks/useDeleteMessages.ts` |
| Criar | `src/components/whatsapp/hooks/useForwardMessages.ts` |
| Criar | `src/components/whatsapp/chat/ForwardMessageDialog.tsx` |
| Editar | `src/components/whatsapp/chat/MessageBubble.tsx` (menu contexto + checkbox + deleted state) |
| Editar | `src/components/whatsapp/chat/ChatMessages.tsx` (seleção props) |
| Editar | `src/components/whatsapp/chat/ChatAreaFull.tsx` (selection mode + action bar) |

