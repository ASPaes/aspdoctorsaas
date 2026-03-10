

## Plano: Unificação de Conversas por Telefone (Cross-Instance)

### Problema Atual

O modelo atual cria **um contato e uma conversa separada por instância** (`whatsapp_contacts` tem unique constraint em `instance_id + phone_number`). Quando "Financeiro" e "Suporte" falam com o mesmo número, surgem 3 entradas na sidebar (Alexandre Paes, Ale, Alexandre) — todas são a mesma pessoa em instâncias diferentes.

### Arquitetura Proposta

Unificar conversas **por telefone + tenant**, mantendo rastreabilidade de qual instância/agente enviou cada mensagem.

```text
ANTES (por instância):                    DEPOIS (por tenant+phone):
┌─────────────────────────┐               ┌─────────────────────────┐
│ Contact A (inst. 1)     │               │ Contact (tenant+phone)  │
│  └─ Conversation A      │               │  └─ Conversation ÚNICA  │
│      └─ Messages...     │               │      ├─ Msg (inst.1)    │
│ Contact B (inst. 2)     │               │      ├─ Msg (inst.2)    │
│  └─ Conversation B      │               │      └─ Msg (inst.1)    │
│      └─ Messages...     │               └─────────────────────────┘
└─────────────────────────┘
```

---

### FASE 1 — Banco de Dados

**1.1 Adicionar `instance_id` em `whatsapp_messages`**
- Nova coluna `instance_id UUID REFERENCES whatsapp_instances(id)` (nullable para retrocompatibilidade)
- Popular retroativamente: `UPDATE whatsapp_messages SET instance_id = c.instance_id FROM whatsapp_conversations c WHERE whatsapp_messages.conversation_id = c.id`
- Índice: `idx_wa_msg_instance ON whatsapp_messages(instance_id)`

**1.2 Novo unique constraint em `whatsapp_contacts`**
- Alterar de `UNIQUE(instance_id, phone_number)` para `UNIQUE(tenant_id, phone_number)` — contato vira tenant-scoped
- Remover FK obrigatória de `instance_id` (manter coluna para referência da primeira instância)
- Tornar `instance_id` nullable em contacts

**1.3 Alterar `whatsapp_conversations`**
- Alterar unique constraint: de `instance_id + contact_id` implícito para `UNIQUE(tenant_id, contact_id)` — uma conversa por contato por tenant
- Tornar `instance_id` nullable (conversa é cross-instance agora)

**1.4 Criar migration de merge para dados existentes**
- Agrupar contacts pelo `tenant_id + phone_number`, manter o registro mais antigo como "principal"
- Redirecionar todas as conversations e messages dos duplicados para o principal
- Deletar contacts duplicados
- Merge de conversations: manter a mais antiga, mover messages das outras

---

### FASE 2 — Edge Functions (Webhook + Send)

**2.1 `evolution-webhook/index.ts`**
- `findOrCreateContact`: buscar por `tenant_id + phone_number` (não mais por `instance_id + phone_number`)
- `findOrCreateConversation`: buscar por `tenant_id + contact_id` (não mais por `instance_id + contact_id`)
- Ao inserir mensagem: incluir `instance_id` do instanceData

**2.2 `send-whatsapp-message/index.ts`**
- A conversa agora não tem `instance_id` fixo — precisa determinar **qual instância usar para enviar**
- Estratégia: usar a instância da última mensagem recebida do contato, ou permitir o frontend escolher
- Gravar `instance_id` na mensagem enviada

---

### FASE 3 — Frontend

**3.1 `useWhatsAppMessages.ts`**
- Incluir `instance_id` no `MESSAGE_SELECT`
- Exibir badge de instância por mensagem no `MessageBubble`

**3.2 `MessageBubble.tsx`**
- Mostrar tag da instância (ex: "Financeiro", "Suporte") acima de mensagens, agrupando por instância/agente

**3.3 Filtros Avançados (`ConversationFiltersPopover`)**
- **Por Instância**: filtrar conversas que possuem mensagens naquela instância (subquery)
- **Por Usuário/Agente**: filtrar por `sent_by_user_id` em mensagens
- **Por Setor**: via `funcionarios.cargo` join com `profiles` do agente

**3.4 `ConversationsSidebar` / `useWhatsAppConversations`**
- Remover filtro direto por `instance_id` na conversa (agora é cross-instance)
- Filtro por instância vira: "conversas que têm mensagens da instância X"
- Mostrar badge com instâncias envolvidas no `ConversationItem`

**3.5 Seletor de Instância no Chat**
- Ao responder, o agente pode escolher por qual instância enviar (dropdown no `ChatInput`)
- Default: última instância que recebeu mensagem do contato

---

### FASE 4 — IA (Resumo, Sentimento, Análise)

- Adicionar filtro por `instance_id`, `sent_by_user_id` nas Edge Functions de análise
- Permitir gerar resumo/sentimento segmentado:
  - Por instância (setor)
  - Por agente
  - Geral (toda a conversa unificada)

---

### Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| Migration de merge pode perder dados | Backup antes; merge via SQL transacional |
| Send precisa saber qual instância usar | Default = última instância do contato, com seletor manual |
| Contatos com nomes diferentes | Manter o nome mais recente (pushName do webhook) |
| Retrocompatibilidade | `instance_id` nullable nos novos schemas; popular dados antigos na migration |

---

### Ordem de Implementação

1. Migration DB (schema + merge de dados existentes)
2. Edge Functions (webhook + send)
3. Frontend (messages, sidebar, filtros, seletor de instância)
4. IA (análise segmentada) — pode ser fase separada

