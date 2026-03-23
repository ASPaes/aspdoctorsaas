

## Diagnóstico IA do Cliente no Histórico Unificado

### Resumo

Adicionar um botão "Diagnóstico IA" no modal de Histórico Unificado que analisa todas as mensagens carregadas e gera uma avaliação completa do contato/cliente. O admin pode então salvar essa avaliação no cadastro do cliente, criando um histórico de avaliações.

### Arquitetura

```text
┌─ ContactHistoryUnifiedModal ─────────────────────────┐
│  [Header: Histórico Unificado]  [🤖 Diagnóstico IA]  │
│                                                       │
│  Filtros │  Timeline de mensagens                     │
│          │                                            │
│          │  ... mensagens ...                         │
│          │                                            │
│          │  ┌─ Diagnóstico Panel (quando gerado) ──┐ │
│          │  │ Resumo geral                          │ │
│          │  │ Sentimento predominante               │ │
│          │  │ Pontos-chave                          │ │
│          │  │ Itens de ação                         │ │
│          │  │ Nota sugerida (1-5)                   │ │
│          │  │ [Registrar no Cliente]                │ │
│          │  └──────────────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
```

### 1. Nova tabela: `cliente_avaliacoes_atendimento`

Armazena o histórico de avaliações registradas pelo admin.

```sql
CREATE TABLE public.cliente_avaliacoes_atendimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.whatsapp_contacts(id),
  avaliado_por uuid REFERENCES auth.users(id),
  nota integer CHECK (nota >= 1 AND nota <= 5),
  sentimento text,          -- positive/neutral/negative
  resumo text NOT NULL,
  pontos_chave text[],
  itens_acao text[],
  periodo_inicio timestamptz,
  periodo_fim timestamptz,
  total_mensagens integer DEFAULT 0,
  total_conversas integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cliente_avaliacoes_atendimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_avaliacoes_tenant_rw" ON public.cliente_avaliacoes_atendimento
  FOR ALL TO authenticated
  USING (can_access_tenant_row(tenant_id))
  WITH CHECK (can_access_tenant_row(tenant_id));
```

### 2. Edge Function: `diagnose-contact-history`

- **Input**: `{ contactId, messages: string[] }` (mensagens já formatadas no frontend para reduzir payload)
- **Auth**: JWT required, resolve tenant via profile
- **Lógica**:
  1. Validate user is admin/head
  2. Get AI config via `getAIConfig(tenantId, supabase)`
  3. Send messages to AI with structured prompt requesting: resumo, sentimento, pontos-chave, itens de ação, nota sugerida (1-5)
  4. Use tool calling to extract structured JSON output
  5. Return the analysis (NOT saved yet -- admin decides)

### 3. Frontend: `useContactDiagnosis` hook

- **File**: `src/components/whatsapp/hooks/useContactDiagnosis.ts`
- Mutation to call `diagnose-contact-history` edge function
- Mutation to save evaluation to `cliente_avaliacoes_atendimento`
- Query to fetch existing evaluations for a cliente_id

### 4. UI Changes in `ContactHistoryUnifiedModal.tsx`

- Add "Diagnóstico IA" button in header (sparkles icon)
- When clicked, sends the loaded messages (formatted as `[timestamp] sender: content`) to the edge function
- Shows result in a collapsible panel at the top of the timeline area:
  - Resumo geral (text)
  - Sentimento predominante (emoji + label)
  - Pontos-chave (bullet list)
  - Itens de ação (bullet list)
  - Nota sugerida (1-5 stars)
  - Admin can edit the nota before saving
  - Button "Registrar no Cliente" -- requires that the contact is linked to a cliente (via conversation metadata). If not linked, show disabled with tooltip
- After saving, show toast success and the evaluation appears in a small "Avaliações anteriores" accordion

### 5. Avaliações no cadastro do cliente (visualização)

- Add a section/tab in the client form (`ClienteForm.tsx` or `DadosClienteTab.tsx`) showing the history of evaluations
- Simple read-only list: date, nota (stars), sentimento, resumo (truncated), avaliado por
- Expandable to see full details

### Dependências entre steps

1. Migration (tabela) → must be first
2. Edge function → depends on table existing
3. Hook → depends on edge function
4. Modal UI → depends on hook
5. Client form section → depends on table

### Files to create/modify

| File | Action |
|------|--------|
| `supabase/migrations/..._create_cliente_avaliacoes.sql` | Create table |
| `supabase/functions/diagnose-contact-history/index.ts` | New edge function |
| `src/components/whatsapp/hooks/useContactDiagnosis.ts` | New hook |
| `src/components/whatsapp/chat/ContactHistoryUnifiedModal.tsx` | Add diagnosis button + panel |
| `src/components/clientes/DadosClienteTab.tsx` | Add evaluations history section |

### Segurança

- Only admin/head can generate and save evaluations
- Tenant isolation via RLS on the new table
- Edge function validates JWT and role before processing
- AI config comes from tenant's `ai_settings` (existing pattern)

