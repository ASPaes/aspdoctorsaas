## Objetivo

Permitir marcar contatos (por número, independente da instância) como "Sem regras DoctorSaaS", desativando todas as automações do sistema para aquele número. Adicionar filtros relacionados na lista de conversas.

## Escopo

### 1. Banco de dados
Adicionar coluna em `whatsapp_contacts`:
- `rules_disabled boolean default false`
- `rules_disabled_at timestamptz`
- `rules_disabled_by uuid`
- `rules_disabled_reason text`

Como o "amarrar por número" deve valer independente da instância, criar função/trigger que ao marcar um contato propaga para todos os `whatsapp_contacts` com mesmo `phone_number` e `tenant_id`.

Index: `idx_whatsapp_contacts_rules_disabled` em `(tenant_id, phone_number, rules_disabled)`.

### 2. Backend — pontos a respeitar a flag

Edge Functions que devem checar `rules_disabled` e fazer **early return** (não acionar regra):
- `check-inactivity-timeout` — não encerrar por inatividade
- `check-csat-timeout` — não enviar/cobrar CSAT
- `finalize-attendance` — bloquear encerramento automático/silencioso (manual continua permitido)
- Webhooks (`evolution-webhook`, `meta-webhook`, `zapi-webhook`) na parte de:
  - Disparo de URA / boas-vindas
  - Auto-reply / off-hours
  - Atribuição automática
  - Categorização IA / smart replies
  - Criação de novo atendimento por timeout
- `schedule-reminder` — não disparar lembretes
- `compose-whatsapp-message` (auto) — pular sugestões automáticas

Padrão: helper `isRulesDisabled(supabase, tenant_id, phone_number)` retornando boolean, chamado no início.

### 3. UI — Chat Details (painel direito da conversa)

Em `src/components/whatsapp/chat/...` (painel de detalhes do contato), nova seção:

```
┌─ Regras do sistema ──────────────────┐
│ ☐ Tirar regras do chat               │
│   Desativa todas automações:          │
│   • Encerramento automático           │
│   • Avisos / lembretes                │
│   • URA                               │
│   • Auto-resposta off-hours           │
│   • Atribuição automática             │
│   Aplica-se a todas as conversas      │
│   deste número.                       │
└───────────────────────────────────────┘
```

Quando marcado, mostra badge "Sem regras" no header do chat e na lista da sidebar.

### 4. Filtros na lista de conversas

Em `src/components/whatsapp/...` (filtros da sidebar), adicionar na seção de filtros:
- Toggle "Sem regras" — clique aplica imediatamente
- Toggle "Apenas auto-respostas pausadas" (existente) — adicionar `(?)` tooltip com explicação:
  > "Mostra conversas onde o agente pausou as respostas automáticas do sistema, mas as demais regras (URA, encerramento, etc.) continuam ativas."

Filtros mutuamente compatíveis (podem combinar).

### 5. Indicadores visuais
- Badge "Sem regras" (variant warning) no `ChatHeader` e item da `ChatList`.
- Ícone ShieldOff ao lado do nome quando ativo.

## Arquivos afetados (resumo)

**DB**: migration nova
**Edge Functions**: ~7 funções com early-return
**Frontend**:
- `src/components/whatsapp/chat/ChatDetailsPanel.tsx` (ou equivalente) — toggle
- `src/components/whatsapp/chat/ChatHeader.tsx` — badge
- `src/components/whatsapp/ChatList*.tsx` — badge + filtro
- Filtros sidebar — novo toggle + tooltip

## Fora do escopo
- Histórico/auditoria detalhada (apenas timestamp + user que ativou)
- Permissão por role (qualquer agente do tenant pode marcar) — pode virar restrição depois

## Pergunta antes de implementar

Esse é um feature grande (DB + 7 edge functions + UI em 3-4 lugares). Prefere:
- **(A)** Implementar tudo agora numa entrega só
- **(B)** Faseado: 1º DB + UI da flag + badge; 2º filtros; 3º edge functions uma a uma
- **(C)** Só DB + UI + 2-3 edge functions mais críticas (encerramento, URA, auto-reply) e o resto depois