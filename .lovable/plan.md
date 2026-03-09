

## Objetivo
Garantir que horário e badge de não lidas apareçam na aba "Todas", idêntico à aba "Não lidas".

## Diagnóstico
- O banco de dados **tem** `unread_count` e `last_message_at` populados (verificado via query)
- O componente `ConversationItem.tsx` **já renderiza** horário e badge corretamente — não há lógica condicional por pill/aba
- A aba "Não lidas" funciona porque filtra `unread_count > 0`, mostrando apenas conversas com esses campos preenchidos

## Hipótese
O problema pode ser que a query do hook retorna `unread_count` como `null` (em vez de `0`) para algumas conversas, e o `??` operator pode não estar capturando todos os casos. Ou o campo `contact` está vindo como `null` para algumas linhas, causando um erro silencioso que impede a renderização.

## Mudanças Propostas

### 1. `src/components/whatsapp/conversations/ConversationItem.tsx`
- Adicionar fallback mais robusto para `unread_count` (tratar `null`, `undefined`, e string)
- Garantir que `formatTime` nunca falha silenciosamente
- Adicionar `console.log` temporário para debug (remover depois) — **ou melhor**, apenas tornar os fallbacks mais defensivos

### 2. `src/components/whatsapp/hooks/useWhatsAppConversations.ts`
- Na query, garantir que `unread_count` sempre vem como número: adicionar `.select('*, contact:whatsapp_contacts(*)')` já faz isso, mas verificar se o `as unknown as ConversationWithContact[]` não está perdendo dados
- Adicionar `coalesce` ou normalização do `unread_count` no resultado mapeado

## Mudança concreta
No hook `useWhatsAppConversations.ts`, normalizar os dados após a query:
```typescript
result = result.map(conv => ({
  ...conv,
  unread_count: Number(conv.unread_count) || 0,
  last_message_at: conv.last_message_at || null,
}));
```

No `ConversationItem.tsx`, reforçar o cálculo:
```typescript
const hasUnread = Number(conv.unread_count) > 0;
```

## Impacto
- Apenas defensivo — sem mudança visual se os dados já estiverem corretos
- Garante consistência entre abas "Todas" e "Não lidas"

