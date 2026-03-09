

## Objetivo
Permitir trocar a instância de uma conversa sem perder o histórico de mensagens.

## Viabilidade
Sim, é possível. As mensagens estão vinculadas ao `conversation_id`, não à instância. O fluxo:

1. Usuário escolhe nova instância
2. Sistema encontra (ou cria) um `whatsapp_contacts` com o mesmo `phone_number` na nova instância
3. Atualiza `whatsapp_conversations.instance_id` e `contact_id` para os novos valores
4. Próximas mensagens são enviadas pela nova instância; histórico permanece intacto

## Mudanças no Código

### 1. Criar `src/components/whatsapp/chat/ChangeInstanceDialog.tsx` (novo)
- Dialog com Select das instâncias dispon<lov-plan>

## Objetivo
Permitir trocar a instância de uma conversa sem perder o histórico de mensagens.

## Viabilidade
Sim, é possível. As mensagens estão vinculadas ao `conversation_id`, não à instância. O fluxo:

1. Usuário escolhe nova instância
2. Sistema encontra (ou cria) um `whatsapp_contacts` com o mesmo `phone_number` na nova instância
3. Atualiza `whatsapp_conversations.instance_id` e `contact_id` para os novos valores
4. Próximas mensagens são enviadas pela nova instância; histórico permanece intacto

## Mudanças no Código

### 1. Criar `src/components/whatsapp/chat/ChangeInstanceDialog.tsx` (novo)
- Dialog com Select das instâncias disponíveis (excluindo a atual)
- Mostra instância atual como referência
- Botão "Trocar Instância" com confirmação
- Ao confirmar:
  - Busca/cria contato (`whatsapp_contacts`) com mesmo `phone_number` na nova instância
  - Atualiza `whatsapp_conversations` com novo `instance_id` e `contact_id`

### 2. Criar hook `src/components/whatsapp/hooks/useChangeInstance.ts` (novo)
- Mutation que:
  1. Busca contato existente na nova instância pelo `phone_number`
  2. Se não existir, cria novo `whatsapp_contacts` com os dados do contato atual (nome, foto, tags) mas `instance_id` da nova instância
  3. Atualiza `whatsapp_conversations.instance_id` e `contact_id`
  4. Invalida queries relevantes

### 3. Editar `src/components/whatsapp/chat/ChatHeader.tsx`
- Adicionar item "Trocar Instância" no DropdownMenu (ícone `ArrowLeftRight`)
- Mostrar apenas quando há mais de 1 instância disponível
- Abrir o `ChangeInstanceDialog`

## Impacto
- **Mensagens**: Preservadas — vinculadas ao `conversation_id`, não muda
- **Envio**: Próximas mensagens usam a nova instância automaticamente (edge function resolve via `conversation.instance_id`)
- **Recebimento**: Mensagens recebidas pelo webhook criam nova conversa se chegarem pela instância antiga — comportamento esperado

## Testes Manuais
1. Abrir conversa > Menu ⋮ > "Trocar Instância"
2. Selecionar nova instância > Confirmar
3. Verificar que histórico de mensagens permanece
4. Enviar mensagem > Verificar que sai pela nova instância
5. Na sidebar, verificar que o indicador de instância mudou

