

## Objetivo
Criar uma Edge Function `transcribe-whatsapp-audio` que transcreve áudios do WhatsApp usando Lovable AI (Gemini), integrando a transcrição ao contexto das conversas para que a IA de sentimento/resumo/categorização considere o conteúdo dos áudios.

## Contexto Atual
- A tabela `whatsapp_messages` já possui as colunas `audio_transcription` e `transcription_status`
- Áudios recebidos/enviados são salvos no bucket privado `whatsapp-media`
- As funções de IA (sentimento, resumo, categorização) só leem `content` — áudios aparecem como "🎵 Áudio"
- `LOVABLE_API_KEY` já está configurada

## Arquitetura

```text
┌──────────────────────┐     ┌──────────────────────────┐
│  evolution-webhook   │────▶│ transcribe-whatsapp-audio │
│  (audio recebido)    │     │  1. Download do Storage   │
│                      │     │  2. Converte p/ base64    │
│  send-whatsapp-msg   │────▶│  3. Envia p/ Gemini      │
│  (audio enviado)     │     │  4. Salva transcrição     │
└──────────────────────┘     └──────────────────────────┘
                                       │
                              ┌────────▼────────┐
                              │ whatsapp_messages│
                              │ audio_transcription = "texto"
                              │ transcription_status = "completed"
                              └─────────────────┘
                                       │
                    ┌──────────────────▼──────────────────┐
                    │  analyze-sentiment / generate-summary│
                    │  Agora lê audio_transcription        │
                    │  em vez de "🎵 Áudio"                │
                    └─────────────────────────────────────┘
```

## Mudanças no Código

### 1. Criar `supabase/functions/transcribe-whatsapp-audio/index.ts`
- Recebe `{ messageId }` (ou `{ messageId, mediaPath, mimetype }`)
- Baixa o áudio do Supabase Storage via signed URL
- Converte para base64 e envia ao Gemini (multimodal) via Lovable AI Gateway para transcrição
- Atualiza `whatsapp_messages` com `audio_transcription` e `transcription_status = 'completed'`
- Em caso de erro, marca `transcription_status = 'failed'`

### 2. Modificar `supabase/functions/evolution-webhook/index.ts`
- Após salvar mensagem de áudio (linha ~714), disparar fire-and-forget `fetch` para `transcribe-whatsapp-audio` passando o messageId
- Similar ao padrão já usado em `checkAndTriggerAutoSentiment`

### 3. Modificar `supabase/functions/send-whatsapp-message/index.ts`
- Após salvar mensagem de áudio enviada, disparar fire-and-forget para transcrição

### 4. Modificar `supabase/functions/analyze-whatsapp-sentiment/index.ts`
- Na query de mensagens (linha 59), adicionar `audio_transcription` ao select
- No `messagesText`, quando `audio_transcription` existir, usar `[Áudio transcrito]: "${audio_transcription}"` em vez de "🎵 Áudio"

### 5. Modificar `supabase/functions/generate-conversation-summary/index.ts`
- Mesma lógica: incluir `audio_transcription` no select e usar no texto quando disponível

### 6. Adicionar ao `supabase/config.toml`
```toml
[functions.transcribe-whatsapp-audio]
verify_jwt = false
```

### 7. UI: Exibir transcrição no `MessageBubble.tsx`
- Para mensagens de áudio, mostrar a transcrição abaixo do player em texto menor e colapsável

## Impacto em Segurança
- Edge Function usa `SUPABASE_SERVICE_ROLE_KEY` para acessar storage e atualizar mensagens (mesmo padrão das demais)
- Sem dados sensíveis expostos ao client

## Testes Manuais
1. Receber um áudio no WhatsApp → verificar que `audio_transcription` é preenchido no DB
2. Enviar um áudio → verificar transcrição
3. Abrir análise de sentimento → verificar que o conteúdo do áudio é considerado
4. Ver transcrição na UI abaixo do player de áudio

