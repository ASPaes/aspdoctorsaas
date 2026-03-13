

## Plan: Análise Final Consolidada + KB Draft com Validação do Técnico

### Problema atual
O fluxo de encerramento faz chamadas separadas (resumo, sentimento, tópicos) e gera KB com dados potencialmente vazios. Não há status intermediário para validação do técnico.

### Arquitetura proposta

Uma **única Edge Function** (`finalize-attendance`) faz uma chamada consolidada de IA no encerramento, retornando tudo de uma vez. O close flow usa esse resultado para popular o attendance e criar o KB draft.

```text
Encerramento
  ├─ Verifica se já existe KB para esse attendance → skip se sim
  ├─ Chama finalize-attendance (1 chamada IA)
  │   └─ Retorna: sentiment, topics, summary, title, problem, solution, tags, suggested_area
  ├─ Salva AI fields no support_attendances
  ├─ Atualiza sentiment na whatsapp_sentiments
  ├─ Atualiza topics no metadata da conversa
  └─ Cria KB draft (status: 'draft')

Técnico (DetailsSidebar)
  ├─ Seção "Base de Conhecimento" aparece quando conversa está closed
  ├─ Mostra preview do draft com botão "Revisar"
  ├─ Abre KBEditDialog (já existente) com botão extra "Enviar para Aprovação"
  └─ Status muda: draft → pending_review

Admin (KBTab em Configurações)
  └─ Vê artigos pending_review e pode aprovar
```

### Mudanças por arquivo

#### 1. Nova Edge Function: `supabase/functions/finalize-attendance/index.ts`
- Recebe `attendanceId`
- Busca mensagens do período do attendance (já existe lógica similar em generate-conversation-summary)
- Faz **uma única chamada** de IA com prompt consolidado que retorna JSON:
  ```json
  {
    "sentiment": "positive|neutral|negative",
    "confidence": 0.85,
    "topics": ["financeiro", "boleto"],
    "summary": "...(máx 100 palavras)",
    "title": "...(máx 80 chars)",
    "problem": "...(máx 150 palavras)",
    "solution": "...(máx 150 palavras)",
    "tags": ["tag1", "tag2"],
    "suggested_area": "financeiro"
  }
  ```
- Prompt otimizado: system message curto, max_completion_tokens reduzido (~800)
- Salva os campos no `support_attendances` (ai_summary, ai_problem, ai_solution, ai_tags)
- Atualiza/insere `whatsapp_sentiments` (sentiment + confidence)
- Atualiza metadata.topics na `whatsapp_conversations`
- Cria KB draft em `support_kb_articles` (com check de duplicata)
- Tenta mapear `suggested_area` para `support_areas.id` por nome

#### 2. Modificar `useWhatsAppActions.ts` (close flow)
- Remover a chamada a `generate-conversation-summary` no encerramento
- Remover o bloco manual de criação de KB draft (linhas 198-251)
- Substituir por uma única chamada fire-and-forget a `finalize-attendance`
- Passa `attendanceId` — a função cuida de tudo

#### 3. Novo hook: `src/components/whatsapp/hooks/useKBDraft.ts`
- Query: busca KB article por `source_attendance_id`
- Mutation `submitForReview`: atualiza status para `pending_review`
- Usado pelo DetailsSidebar

#### 4. Modificar `DetailsSidebar.tsx`
- Nova seção colapsável "Base de Conhecimento" (após Resumos)
- Aparece quando existe attendance fechado para a conversa
- Mostra título + status do draft
- Botão "Revisar" abre o KBEditDialog existente
- Botão "Enviar para Aprovação" (atalho direto)

#### 5. Modificar `KBEditDialog.tsx`
- Adicionar status `pending_review` nos labels/cores
- Adicionar botão "Enviar para Aprovação" no footer (quando status = draft)
- O botão muda status para `pending_review`

#### 6. Modificar `KBTab.tsx`
- Adicionar `pending_review` ao filtro de status e labels

#### 7. Adicionar `finalize-attendance` ao `supabase/config.toml`
- `verify_jwt = false` (validação manual no código)

### Economia de tokens
| Antes | Depois |
|---|---|
| generate-conversation-summary (~1500 tokens output) | finalize-attendance (~800 tokens output) |
| analyze-whatsapp-sentiment (chamada separada) | Incluído na chamada única |
| categorize-whatsapp-conversation (chamada separada) | Incluído na chamada única |
| **3 chamadas IA por encerramento** | **1 chamada IA por encerramento** |

### Proteções
- Se já existe KB para o attendance, skip total (zero chamadas IA)
- Se IA não configurada, encerramento funciona normalmente sem IA
- Erros na finalização não bloqueiam o encerramento
- `generate-conversation-summary` continua existindo para resumos manuais do contato (uso diferente)

