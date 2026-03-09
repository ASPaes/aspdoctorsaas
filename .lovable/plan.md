

## Objetivo
4 melhorias na sidebar de conversas do WhatsApp:

0. **Novo chat em primeiro**: Ao criar/abrir um chat, ele aparece no topo da lista
1. **Indicador discreto de instância**: Mostrar nome da instância em cada item da lista
2. **Filtros ativos visíveis**: Exibir badges dos filtros aplicados abaixo das QuickPills
3. **Ocultar conversas sem mensagens**: Conversas com `last_message_at = null` não aparecem na lista (exceto quando são abertas/criadas ativamente)

## Mudanças no Código

### `src/components/whatsapp/hooks/useWhatsAppConversations.ts`
- Adicionar filtro `.not('last_message_at', 'is', null)` na query principal para excluir conversas sem mensagens
- Aceitar um novo parâmetro opcional `includeIds?: string[]` nos filtros — quando presente, usa `.or()` para incluir essas conversas específicas mesmo sem mensagens (para quando o usuário acabou de criar/abrir um chat)

### `src/components/whatsapp/conversations/ConversationItem.tsx`
- Receber `instanceName` como prop
- Exibir o nome da instância como texto discreto (text-[10px], text-muted-foreground) ao lado do status dot ou abaixo do preview da última mensagem

### `src/components/whatsapp/conversations/ConversationsSidebar.tsx`
- Mapear `instances` por ID para passar `instanceName` ao `ConversationItem`
- Importar `useWhatsAppInstances` para obter a lista de instâncias
- Adicionar seção de **badges de filtros ativos** entre as QuickPills e a lista (mostrar badges para: status, instância, ordenação ≠ "recent")
- Manter um state `forcedConvId` que é setado quando `handleCreated` ou `onSelect` é chamado — passado como `includeIds` ao hook para garantir que o chat recém-criado apareça na lista

### `src/components/whatsapp/conversations/QuickPills.tsx` (ou nova seção no Sidebar)
- Adicionar área abaixo das pills para exibir chips removíveis dos filtros ativos (ex: "Status: Em Aberto ✕", "Instância: Vendas ✕")

## Impacto
- **UI**: Instância visível discretamente em cada item; filtros ativos como chips removíveis
- **Dados**: Conversas sem mensagens ficam ocultas por padrão na query
- **Estado**: Novo state para forçar inclusão de conversa recém-criada

## Testes Manuais
1. Criar nova conversa → deve aparecer em primeiro na lista
2. Verificar que conversas "Sem mensagens" não aparecem mais na lista
3. Aplicar filtro de Status ou Instância → badge aparece abaixo das pills
4. Remover badge → filtro é limpo
5. Verificar nome da instância aparece discretamente em cada item

