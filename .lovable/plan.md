

## Objetivo
Corrigir o bug onde conversas ficam permanentemente marcadas como "Fora do horário" mesmo quando mensagens chegam durante o horário comercial.

## Causa raiz
No `evolution-webhook`, quando uma mensagem chega **durante** o horário comercial, o código simplesmente pula o bloco de fora-do-horário (`bhResult.inside === true`), mas **nunca limpa** o flag `opened_out_of_hours = true` que foi definido anteriormente. O `getConversationBucket` no frontend usa esse flag para classificar a conversa, mantendo-a presa no balde "Fora do horário" indefinidamente.

## Mudanças no código

### 1. `supabase/functions/evolution-webhook/index.ts`
Após o check `if (supportConfigBH.business_hours_enabled)` e `bhResult.inside === true`, adicionar lógica para limpar o flag:

```typescript
if (bhResult.inside) {
  // Se a conversa estava marcada como fora do horário, limpar o flag
  const { data: convBHClear } = await supabase
    .from('whatsapp_conversations')
    .select('opened_out_of_hours')
    .eq('id', conversationId)
    .single();

  if (convBHClear?.opened_out_of_hours) {
    await supabase
      .from('whatsapp_conversations')
      .update({
        opened_out_of_hours: false,
        out_of_hours_cleared_at: new Date().toISOString(),
      })
      .eq('id', conversationId);
    console.log(`[business-hours] Flag fora-do-horário limpo conv=${conversationId}`);
  }
}
```

Isso vai inserir entre a linha ~1024 (resultado do `checkBusinessHours`) e o bloco `if (!bhResult.inside)`, garantindo que quando uma mensagem do cliente chega dentro do horário, o flag é resetado.

### 2. Correção de dados existentes (opcional — migration)
Criar migration para limpar conversas que estão incorretamente marcadas como `opened_out_of_hours = true` mas têm atendimento ativo ou foram respondidas:

```sql
UPDATE whatsapp_conversations
SET opened_out_of_hours = false,
    out_of_hours_cleared_at = now()
WHERE opened_out_of_hours = true
  AND out_of_hours_cleared_at IS NULL
  AND (first_agent_message_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM support_attendances sa
      WHERE sa.conversation_id = whatsapp_conversations.id
        AND sa.status IN ('in_progress', 'closed', 'inactive_closed')
    ));
```

## Impacto
- **UI**: Conversas voltarão para a fila normal ("Aguardando") quando mensagens chegarem durante o horário comercial
- **Backend**: Uma query extra por mensagem recebida durante business hours (apenas para verificar se o flag está ativo)
- **Segurança**: Sem impacto

## Testes manuais
1. Configurar horário de atendimento no tenant
2. Enviar mensagem fora do horário → deve aparecer em "Fora do horário"
3. Enviar mensagem durante o horário → conversa deve sair de "Fora do horário" e ir para "Fila"

