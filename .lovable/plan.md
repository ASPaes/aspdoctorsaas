

## Objetivo
Duas correções:

1. **Handle de redimensionamento visível** — transformar a borda de arrasto em uma mini-coluna visível (barra vertical fina com grip), conforme marcado na imagem
2. **Horário e badge na aba "Todas"** — investigar e corrigir por que `last_message_at` e `unread_count` não renderizam na pill "Todas"

## Análise

### Handle
O `ResizableHandle` atual usa `w-px` (1px de largura) com um pequeno ícone de grip centralizado. O usuário quer uma barra vertical mais visível — uma "mini coluna" que funcione como alça de arrasto.

**Solução**: No `WhatsApp.tsx`, passar `className` customizado ao `ResizableHandle` para aumentar a largura e dar aparência de coluna fina (ex: `w-1.5 bg-border hover:bg-primary/20 transition-colors`), removendo o `withHandle` pequeno e usando um estilo mais largo e visível.

### Horário e Badge em "Todas"
O código do `ConversationItem.tsx` já renderiza horário e badge sem condição de pill — ou seja, deveria funcionar em qualquer aba. O problema provavelmente é que `unread_count` vem como `null` ou tipo inesperado do Supabase, e `Number(null) || 0` retorna `0`, mascarando valores reais.

**Solução**: Adicionar `console.log` de debug temporário no `ConversationItem` para verificar os valores brutos de `conv.unread_count` e `conv.last_message_at`. Se os dados estiverem corretos no componente, o problema pode estar no hook. Revisarei o hook para garantir a normalização dos dados.

## Mudanças no Código

### 1. `src/pages/WhatsApp.tsx`
- Trocar `<ResizableHandle withHandle />` por `<ResizableHandle className="w-1.5 bg-muted hover:bg-primary/20 transition-colors" />` — barra fina visível sem o grip icon pequeno, mas com cursor de arrasto

### 2. `src/components/ui/resizable.tsx`
- Ajustar o `ResizableHandle` para quando não usar `withHandle`, exibir a barra com largura adequada sem o `w-px` forçado (permitir override via className)

### 3. `src/components/whatsapp/conversations/ConversationItem.tsx`
- Forçar conversão defensiva: `const unreadCount = typeof conv.unread_count === 'number' ? conv.unread_count : parseInt(String(conv.unread_count), 10) || 0;`
- Usar `unreadCount` nas renderizações

### 4. `src/components/whatsapp/hooks/useWhatsAppConversations.ts`
- Na normalização do resultado, garantir cast mais agressivo: `unread_count: parseInt(String(conv.unread_count ?? 0), 10) || 0`

## Impacto
- **UI**: Handle de redimensionamento mais visível; badge e horário consistentes em todas as pills
- **Estado**: Nenhum
- **DB/Edge**: Nenhum

## Testes Manuais
1. Abrir /whatsapp → verificar barra de arrasto visível entre sidebar e chat
2. Na pill "Todas", verificar que conversas com mensagens não lidas mostram horário verde e bolinha verde com número
3. Arrastar a barra para redimensionar — deve funcionar suavemente

