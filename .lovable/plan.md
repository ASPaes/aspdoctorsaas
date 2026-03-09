

## Objetivo
Identificar visualmente quem do time enviou cada mensagem e indicar transferências de conversa no histórico do chat.

## Mudanças no Banco de Dados

### Nova coluna em `whatsapp_messages`
```sql
ALTER TABLE whatsapp_messages ADD COLUMN sent_by_user_id UUID REFERENCES auth.users(id);
```
Armazena o user_id do agente que enviou cada mensagem `is_from_me = true`.

## Mudanças no Código

### 1. `supabase/functions/send-whatsapp-message/index.ts`
- Extrair `userId` do JWT claims (`claimsData.claims.sub`)
- Incluir `sent_by_user_id: userId` no insert de `whatsapp_messages`

### 2. `src/components/whatsapp/hooks/useWhatsAppMessages.ts`
- Adicionar `sent_by_user_id` à interface `Message`
- Alterar query para fazer join: `*, profiles!sent_by_user_id(funcionario_id, funcionarios(nome, cargo))`
- Expor campos `sender_name` e `sender_role` no tipo Message (mapeados do join)

### 3. `src/components/whatsapp/chat/MessageBubble.tsx`
- Para mensagens `is_from_me`, exibir o nome do agente + cargo acima do conteúdo da mensagem em texto pequeno (ex: "João Silva · Suporte")
- Estilo: `text-[10px] font-semibold opacity-80` na cor do tema da bolha

### 4. `src/components/whatsapp/chat/ChatMessages.tsx`
- Buscar `conversation_assignments` para a conversa atual
- Inserir indicadores visuais de transferência entre mensagens quando houver mudança de agente (similar aos date labels)
- Formato: "🔄 Transferido para João Silva · Suporte" com timestamp

### 5. Novo hook: `src/components/whatsapp/hooks/useConversationAssignmentHistory.ts`
- Query em `conversation_assignments` com join em `profiles → funcionarios` para resolver nomes
- Ordenado por `created_at` para intercalar no timeline

## Impacto em Segurança
- Coluna `sent_by_user_id` referencia `auth.users(id)`, sem RLS adicional necessário (herda da tabela)
- Sem dados sensíveis expostos

## Testes Manuais
1. Enviar mensagem → verificar que o nome e cargo do agente aparece na bolha
2. Transferir conversa para outro agente → verificar indicador de transferência no chat
3. Segundo agente envia mensagem → verificar que o nome muda na bolha

