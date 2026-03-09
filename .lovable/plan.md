

## Objetivo
1. Substituir o filtro inline atual por um **Popover de Filtros Avançados** (como no ASP Chat), com Ordenação, Status e Instância.
2. Garantir que a lista de conversas **sempre ordene pela última mensagem** (enviada ou recebida) — comportamento idêntico ao WhatsApp oficial.

## Mudanças no Código

### 1. Criar `ConversationFiltersPopover.tsx` (novo)
Substituir o `ConversationFilters.tsx` inline por um Popover estilo ASP Chat:
- Botão "Filtros" com badge de contagem de filtros ativos
- Popover com 3 seções: **Ordenação** (Mais Recentes, Não Lidas Primeiro, Aguardando Resposta, Mais Antigas), **Status** (Todas, Em Aberto, Encerradas, Arquivadas), **Instância** (dropdown com instâncias disponíveis)
- Botão "Limpar Filtros" quando há filtros ativos

### 2. Atualizar `ConversationsSidebar.tsx`
- Substituir o toggle de `showFilters` + `ConversationFilters` pelo novo `ConversationFiltersPopover`
- Adicionar state `sortBy` para controlar a ordenação
- Posicionar o botão de filtros ao lado das QuickPills (mesma linha)
- Aplicar ordenação local no `useMemo` de `filtered` conforme `sortBy`

### 3. Garantir ordenação por última atividade (comportamento WhatsApp)
A query no `useWhatsAppConversations.ts` já ordena por `last_message_at DESC` — isso é correto. O que falta garantir:
- O campo `last_message_at` e `last_message_preview` da conversa sejam atualizados tanto ao **receber** quanto ao **enviar** mensagens
- O realtime subscription já invalida a query ao detectar mudanças na tabela `whatsapp_conversations`, então a reordenação é automática
- Ao criar uma nova conversa, o `created_at` ou `last_message_at` garante que ela aparece no topo

A ordenação padrão `last_message_at DESC` já implementa o comportamento do WhatsApp. As opções de ordenação alternativa (não lidas primeiro, aguardando, mais antigas) serão aplicadas como sort local no frontend.

### 4. Remover `ConversationFilters.tsx` antigo
Não mais necessário — será substituído pelo Popover.

## Arquivos

| Arquivo | Ação |
|---------|------|
| `src/components/whatsapp/conversations/ConversationFiltersPopover.tsx` | **Criar** — Popover com Ordenação + Status + Instância |
| `src/components/whatsapp/conversations/ConversationsSidebar.tsx` | **Editar** — usar Popover, adicionar sortBy, posicionar ao lado das pills |
| `src/components/whatsapp/conversations/ConversationFilters.tsx` | **Manter** (pode ser removido depois, mas não bloqueia) |

## Impacto
- **UI**: Filtros mais limpos em Popover, mesma linha que as pills
- **Ordenação**: Padrão "Mais Recentes" (last_message_at DESC) + opções alternativas
- **Realtime**: Já funciona — invalidação automática reordena a lista

## Testes Manuais
1. Abrir Chat > verificar botão "Filtros" ao lado das pills
2. Clicar Filtros > alterar Ordenação para "Mais Antigas" > confirmar reordenação
3. Enviar mensagem > verificar que a conversa sobe para o topo da lista
4. Receber mensagem > verificar que a conversa sobe para o topo
5. Criar nova conversa > verificar que aparece em primeiro

