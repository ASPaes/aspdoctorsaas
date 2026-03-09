

## Objetivo
Corrigir dois problemas na sidebar de conversas:

1. **Ordenação incorreta**: Conversas não estão ordenadas pela última mensagem mais recente. O campo `last_message_at` no banco pode estar desatualizado (não refletindo mensagens enviadas pelo agente). A query já ordena por `last_message_at DESC`, mas o valor no DB pode não estar sendo atualizado ao enviar mensagens.

2. **Busca não funciona**: O parâmetro `search` é recebido no hook `useWhatsAppConversations` mas nunca é aplicado na query. A busca precisa filtrar por nome do contato, telefone e conteúdo das mensagens.

## Mudanças no Código

### 1. `src/components/whatsapp/hooks/useWhatsAppConversations.ts`
- **Adicionar filtro de busca na query**: Quando `filters.search` estiver preenchido, filtrar por nome do contato (`whatsapp_contacts.name`) e telefone (`whatsapp_contacts.phone_number`) usando `ilike`
- **Integrar busca por conteúdo de mensagens**: Quando o search tiver 3+ caracteres, buscar `conversation_id`s na tabela `whatsapp_messages` cujo `content` contenha o termo, e incluir esses IDs no resultado via `.or()` combinando filtro de contato + IDs de mensagens encontradas

### 2. `src/components/whatsapp/hooks/useWhatsAppConversations.ts` (ordenação)
- Verificar se ao enviar uma mensagem, o campo `last_message_at` da conversa é atualizado. Investigar o fluxo de envio.

### 3. `src/components/whatsapp/hooks/useWhatsAppSend.ts` (se necessário)
- Após envio bem-sucedido de mensagem, atualizar `last_message_at` e `last_message_preview` na tabela `whatsapp_conversations` para garantir que a ordenação reflita a realidade

### 4. `src/components/whatsapp/conversations/ConversationsSidebar.tsx`
- Remover filtro local de busca redundante (se houver) — a busca será feita no hook

## Investigação necessária
Antes de implementar, preciso verificar:
- O hook `useWhatsAppSend` / fluxo de envio de mensagem — se atualiza `last_message_at` na conversa
- O webhook `evolution-webhook` — se atualiza `last_message_at` ao receber mensagem

## Testes Manuais
1. Enviar mensagem em uma conversa → verificar que ela sobe para o topo da lista
2. Digitar nome de contato na busca → deve filtrar
3. Digitar texto de mensagem na busca (3+ chars) → deve mostrar conversas que contêm aquele texto

