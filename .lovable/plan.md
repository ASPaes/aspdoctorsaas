

## Objetivo
Implementar análise final consolidada de IA no encerramento do atendimento + geração de KB draft com validação do técnico.

## Status: ✅ Implementado

## Arquitetura

### Fluxo de encerramento (1 chamada IA)
```
Encerramento
  ├─ Verifica se já existe KB para esse attendance → skip se sim
  ├─ Chama finalize-attendance (1 chamada IA consolidada)
  │   └─ Retorna: sentiment, topics, summary, title, problem, solution, tags, suggested_area
  ├─ Salva AI fields no support_attendances
  ├─ Atualiza sentiment na whatsapp_sentiments
  ├─ Atualiza topics no metadata da conversa
  └─ Cria KB draft (status: 'draft')
```

### Fluxo do técnico
```
DetailsSidebar → Seção "Base de Conhecimento"
  ├─ Mostra título + status do draft
  ├─ Botão "Revisar" → abre KBEditDialog
  ├─ Botão "Enviar" → muda status para pending_review
  └─ KBEditDialog tem botão "Enviar para Aprovação"
```

### Status do KB
- `draft` → Rascunho (gerado pela IA)
- `pending_review` → Validado pelo técnico, aguardando aprovação do admin
- `approved` → Aprovado pelo admin

## Arquivos alterados

| Arquivo | Ação |
|---|---|
| `supabase/functions/finalize-attendance/index.ts` | **Novo** — Edge Function consolidada |
| `src/components/whatsapp/hooks/useKBDraft.ts` | **Novo** — Hook para KB draft |
| `src/components/whatsapp/hooks/useWhatsAppActions.ts` | Modificado — fire-and-forget para finalize-attendance |
| `src/components/whatsapp/chat/DetailsSidebar.tsx` | Modificado — seção KB |
| `src/components/configuracoes/KBTab.tsx` | Modificado — status pending_review |
| `src/components/configuracoes/kb/KBEditDialog.tsx` | Modificado — status + botão aprovação |
| `supabase/config.toml` | Modificado — finalize-attendance entry |
