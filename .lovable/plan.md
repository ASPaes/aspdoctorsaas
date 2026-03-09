

## Objetivo

Duas funcionalidades:
1. **CS Tickets**: Botão "WhatsApp" nos tickets abertos/ativos para abrir chat com o cliente, e exibir conversas/resumos do WhatsApp vinculados na timeline do ticket.
2. **Certificado A1**: Botão "WhatsApp" na tabela de vendas detalhadas para contatar o cliente sobre certificado.

## Mudanças no Código

### 1. `src/components/cs/hooks/useCSTickets.ts`
- Adicionar `telefone_whatsapp` ao select do join `cliente:clientes` (nas queries `useCSTickets` e `useCSTicket`).

### 2. `src/components/cs/types.ts`
- Adicionar `telefone_whatsapp: string | null` ao tipo `cliente` dentro de `CSTicket`.

### 3. `src/components/cs/CSTicketDetailContent.tsx`
- Adicionar botão "WhatsApp" na seção de Quick Actions, que navega para `/whatsapp?phone=...&clienteId=...&clienteName=...` (mesmo padrão do DadosClienteTab).
- Visível apenas se o ticket tem `cliente_id` e o cliente tem `telefone_whatsapp`.

### 4. `src/components/cs/CSTimelineEnhanced.tsx`
- Adicionar uma seção que busca conversas do WhatsApp vinculadas ao cliente do ticket (via `whatsapp_contacts.phone_number` matching `clientes.telefone_whatsapp`).
- Exibir resumos (`whatsapp_conversation_summaries`) das conversas encontradas como itens especiais na timeline, com ícone de WhatsApp e badge "Resumo WhatsApp".

### 5. `src/components/certificados/CertA1Dashboard.tsx`
- Adicionar `telefone_whatsapp` ao select de clientes na query.
- Adicionar coluna "WhatsApp" na tabela de vendas detalhadas com botão/ícone que navega para `/whatsapp?phone=...&clienteId=...&clienteName=...`.

## Impacto em Segurança
- Sem novas tabelas ou migrations.
- Usa dados já protegidos por RLS existente.

## Testes Manuais
1. Abrir ticket CS com cliente → verificar botão WhatsApp nas ações rápidas.
2. Clicar → verificar que abre a conversa no módulo WhatsApp.
3. Na timeline do ticket, verificar que resumos de conversas do WhatsApp aparecem.
4. No dashboard de Certificados A1, verificar botão WhatsApp na tabela de vendas.

