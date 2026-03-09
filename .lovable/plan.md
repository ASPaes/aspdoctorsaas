

## Objetivo
Duas melhorias na sidebar de conversas:

1. **Sidebar redimensionável** — permitir ao usuário arrastar a borda direita para aumentar/diminuir a largura horizontalmente
2. **Layout do item de conversa melhorado** — exibir hora da última mensagem, preview com "Você: ..." quando a última mensagem é do agente, e badge de não lidas no estilo WhatsApp (referência segunda imagem)

## Mudanças no Código

### 1. `src/pages/WhatsApp.tsx`
- Substituir o layout `flex` fixo por `ResizablePanelGroup` com dois painéis (`ResizablePanel`)
- Painel esquerdo (sidebar): `defaultSize={25}`, `minSize={18}`, `maxSize={40}`
- Painel direito (chat): flex restante
- Usar `ResizableHandle` entre eles para arrastar
- Remover a largura fixa `w-80` da sidebar (será controlada pelo painel)

### 2. `src/components/whatsapp/conversations/ConversationsSidebar.tsx`
- Remover `w-80 shrink-0` do container — a largura será controlada pelo `ResizablePanel` pai

### 3. `src/components/whatsapp/conversations/ConversationItem.tsx`
- **Hora**: Usar `formatRelativeTime` para mostrar hora (HH:mm) para hoje, dia da semana para esta semana, e data para mais antigo — similar ao WhatsApp real
- **Preview com remetente**: Quando `conv.isLastMessageFromMe` for true, prefixar o preview com "Você: " (mantendo o ícone de check duplo)
- **Badge de não lidas**: Manter estilo atual (já está OK) mas garantir que a hora fique verde/destacada quando há mensagens não lidas (como no WhatsApp)
- Ajustar a hora para ficar com cor `text-primary` quando `unread_count > 0`

## Impacto
- **UI**: Sidebar flexível, layout mais informativo nos itens de conversa
- **Estado**: Nenhuma mudança de estado
- **DB/Edge**: Nenhuma mudança

