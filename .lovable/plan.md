

## Plano: Exibição Completa de Anexos no Chat (WhatsApp-like)

### Visão Geral

Implementar cards de anexo ricos no chat mostrando nome do arquivo, extensão, tamanho, tipo e ações Abrir/Baixar — tudo via proxy seguro (sem link direto do Storage).

---

### PARTE A — Banco de Dados (Migration)

**A1) Novas colunas em `whatsapp_messages`:**
```sql
media_path text null
media_filename text null
media_ext text null
media_size_bytes bigint null
media_kind text null  -- 'document'|'image'|'audio'|'video'|'other'
```
Não adicionar `media_bucket` (fixo `whatsapp-media`) nem `media_mime` (já existe `media_mimetype`).

**A2) Backfill:**
- Extrair `media_path` de `media_url` (remover prefixo signed URL se houver, ou usar direto se já for path)
- `media_filename` de `metadata->>'fileName'` ou último segmento do path
- `media_ext` do filename
- `media_kind` do `media_mimetype` ou `message_type`

**A3) Índice:** `(tenant_id, conversation_id, timestamp DESC)` se não existir.

---

### PARTE B — Edge Functions

**B1) Nova Edge Function `whatsapp-media-proxy`** (GET)
- Query params: `message_row_id`, `mode=inline|attachment`
- Autenticação via Bearer token + getClaims
- Busca mensagem por `id` + valida tenant via profiles
- Baixa arquivo do Storage com service role
- Responde com bytes + `Content-Type` + `Content-Disposition` correto
- Se `media_size_bytes` estiver null, mede e atualiza no DB (lazy backfill)
- Cache-Control: private, max-age=60

**B2) Atualizar `send-whatsapp-message`:**
- Ao salvar mensagem com mídia, popular `media_path`, `media_filename`, `media_ext`, `media_kind`, `media_size_bytes` (bytes.length do upload)

**B3) Atualizar `evolution-webhook`:**
- Ao salvar mensagem com mídia recebida, popular `media_path` (já temos `filePath`), `media_filename` (do `documentMessage.fileName` ou gerar), `media_ext`, `media_kind`, `media_size_bytes` (do blob.size)

---

### PARTE C — Frontend

**C1) Util `formatBytes(bytes)`** em `src/utils/whatsapp/formatBytes.ts`

**C2) Novo componente `AttachmentCard`** substitui a renderização de `document` no `MediaContent`
- Exibe: ícone por tipo, nome do arquivo, badge de extensão, tamanho formatado
- Botões: Abrir (abre proxy inline em nova aba) e Baixar (link com mode=attachment + download)
- URL construída com `VITE_SUPABASE_URL/functions/v1/whatsapp-media-proxy?message_row_id=X&mode=Y`
- Headers de auth enviados via fetch para download; para abrir inline, URL direta funciona pois a edge function aceita token via query param

**C3) Atualizar `MediaContent.tsx`:**
- Imagens e vídeos: manter preview visual via signed URL (já funciona)
- Documentos: usar `AttachmentCard` ao invés do link simples
- Áudio: manter player existente
- Adicionar exibição de filename/size abaixo de imagens e vídeos também

**C4) Atualizar `useWhatsAppMessages.ts`:**
- Incluir novas colunas no `MESSAGE_SELECT`: `media_path`, `media_filename`, `media_ext`, `media_size_bytes`, `media_kind`

**C5) Hook `useMediaMeta`** (React Query)
- Para mensagens onde `media_url` existe mas `media_filename` ou `media_size_bytes` estão null
- Chama proxy com HEAD ou meta endpoint para lazy-fill
- staleTime: 10min

---

### Segurança
- Proxy valida tenant via JWT claims → profiles → tenant_id match com a mensagem
- Nunca expõe URL direta do Storage ao usuário
- Service role usado apenas server-side no proxy

---

### Ordem de Implementação
1. Migration DB (colunas + backfill)
2. Atualizar `evolution-webhook` e `send-whatsapp-message` (popular novas colunas)
3. Criar `whatsapp-media-proxy` edge function
4. Frontend: util + AttachmentCard + MediaContent refactor + MESSAGE_SELECT update

