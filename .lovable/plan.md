

## Objetivo

Criar um sistema inteligente que avalia sentimentos de conversas WhatsApp e alerta o operador quando um ticket CS deve ser aberto, com contexto completo da conversa incluso no ticket.

## Escopo das Mudanças

### 1. Ampliar a Edge Function de Sentimento (`analyze-whatsapp-sentiment`)

A IA já analisa sentimento (positive/neutral/negative). Vamos adicionar ao tool call da IA um campo `needs_cs_ticket` (boolean) e `cs_ticket_reason` (string) para que a IA avalie se a conversa indica necessidade de atenção do CS (ex: reclamação persistente, risco de churn, insatisfação, pedido de cancelamento).

Salvar esses campos na tabela `whatsapp_sentiment_analysis` (migração para adicionar colunas `needs_cs_ticket boolean default false` e `cs_ticket_reason text`).

### 2. Alerta Visual no ConversationItem (Lista de Conversas)

Quando `needs_cs_ticket = true`, exibir um indicador visual (badge/ícone vermelho pulsante) na lista de conversas para chamar atenção do operador a qualquer momento, mesmo sem abrir a conversa.

### 3. Alerta no ChatHeader

Quando a conversa tem `needs_cs_ticket = true`, exibir um banner/alerta compacto no header do chat com botão "Abrir Ticket CS".

### 4. Alerta no DetailsSidebar (Sentimento IA)

Na seção de sentimento, quando `needs_cs_ticket = true`, destacar visualmente e exibir o motivo (`cs_ticket_reason`) com botão para abrir ticket.

### 5. Criação de Ticket CS com Contexto da Conversa

Criar um componente `CSTicketFromWhatsApp` (ou reutilizar `CSTicketForm` com props adicionais) que:
- Pre-preencha o **cliente vinculado** (se existir via metadata)
- Pre-preencha o **assunto** com base no `cs_ticket_reason`
- Pre-preencha a **descrição** com: resumo do sentimento, keywords, últimas mensagens relevantes, e summary da conversa (se existir)
- Defina o **tipo** como `risco_churn` (sentimento negativo) ou `adocao_engajamento` (sentimento neutro com alerta)
- Defina **prioridade** como `alta` automaticamente
- Inclua link/referência à conversa WhatsApp no ticket

### 6. Migração de Banco de Dados

```sql
ALTER TABLE whatsapp_sentiment_analysis 
  ADD COLUMN needs_cs_ticket boolean NOT NULL DEFAULT false,
  ADD COLUMN cs_ticket_reason text,
  ADD COLUMN cs_ticket_created_id uuid REFERENCES cs_tickets(id);
```

O campo `cs_ticket_created_id` rastreia se o ticket já foi criado, evitando alertas duplicados.

## Arquivos a Modificar

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/analyze-whatsapp-sentiment/index.ts` | Adicionar campos `needs_cs_ticket` e `cs_ticket_reason` ao tool call da IA e ao upsert |
| `src/components/whatsapp/conversations/ConversationItem.tsx` | Query de sentimento + badge de alerta CS |
| `src/components/whatsapp/chat/ChatHeader.tsx` | Banner de alerta CS com botão "Abrir Ticket" |
| `src/components/whatsapp/chat/DetailsSidebar.tsx` | Destaque na seção de sentimento + botão abrir ticket |
| `src/components/whatsapp/hooks/useWhatsAppSentiment.ts` | Sem mudanças (já retorna `*` da tabela) |
| **Novo**: `src/components/whatsapp/chat/CSTicketAlert.tsx` | Componente de alerta reutilizável (banner + modal) |
| **Novo**: `src/components/whatsapp/chat/CreateCSTicketFromChat.tsx` | Modal que wrapa CSTicketForm com dados pre-preenchidos da conversa |

## Impacto em Segurança

- **RLS**: Tabela `whatsapp_sentiment_analysis` já tem RLS via `can_access_tenant_row`. Novas colunas herdam as policies existentes.
- **Tenant**: Todas as queries já filtram por tenant.

## Fluxo do Operador

```text
1. IA analisa sentimento → detecta necessidade de CS
2. ConversationItem mostra ⚠️ na lista
3. Operador abre conversa → vê banner "Atenção: IA detectou risco"
4. Clica "Abrir Ticket CS" → modal pre-preenchido
5. Confirma → ticket criado com contexto da conversa
6. Alerta desaparece (cs_ticket_created_id preenchido)
```

## Testes Manuais

1. Abrir conversa com cliente insatisfeito
2. Clicar "Analisar sentimento"
3. Verificar se alerta aparece na lista e no chat
4. Clicar "Abrir Ticket CS" e validar dados pre-preenchidos
5. Confirmar criação e verificar que alerta desaparece
6. Verificar ticket no módulo CS com contexto da conversa

