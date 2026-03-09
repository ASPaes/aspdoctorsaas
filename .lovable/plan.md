

## Objetivo
Corrigir 3 problemas no chat WhatsApp: (1) scrollbar e caixa de input desaparecem quando há mídias, (2) áudios/arquivos enviados não aparecem para o remetente, (3) áudio mostra 0:00/0:00 após ouvir/atualizar.

## Diagnóstico

### Problema 1: Layout quebrado (sem scroll e sem input)
O `ScrollArea` do Radix usa `overflow: hidden` no Root e `h-full w-full` no Viewport. Quando está dentro de um flex-col com `flex-1`, o Viewport precisa que o Root tenha uma altura computada. O problema é que `ScrollArea` com `className="flex-1"` não recebe `h-0` ou `min-h-0`, então o conteúdo interno (especialmente com imagens/áudios que expandem) pode fazer o Root crescer além do espaço disponível, empurrando o `ChatInput` para fora da tela.

**Solução**: Adicionar `overflow-hidden` ao container flex-col do chat e garantir que o ScrollArea tenha constraint de altura (`min-h-0` + usar wrapper div com `flex-1 min-h-0 overflow-hidden`).

### Problema 2: Mídia enviada não aparece para o remetente
Quando o usuário envia áudio via base64 ou arquivo via base64, o fluxo é:
1. Optimistic update cria mensagem com `media_url: null` (porque `mediaUrl` não é passado para áudio/base64)
2. Edge function envia para Evolution API e extrai URL da resposta (`extractedMediaUrl`)
3. Se Evolution não retorna URL no response body, `media_url` fica `null` no DB
4. Mesmo que retorne, é uma URL temporária do WhatsApp que expira rapidamente

**Solução**: Na edge function, quando `mediaBase64` é fornecido, fazer upload do arquivo para Supabase Storage (`whatsapp-media` bucket) antes de enviar para Evolution, e salvar o path do storage como `media_url`. Isso garante que o remetente veja a mídia permanentemente.

### Problema 3: Áudio 0:00/0:00 após ouvir
O `<audio>` usa `preload="none"`, e quando o componente re-renderiza (signed URL muda), o elemento de áudio reinicia. Além disso, se a `media_url` é uma URL externa temporária do WhatsApp, ela expira.

**Solução**: Mudar `preload` de `"none"` para `"metadata"` para que o browser carregue duração/metadata. Combinado com a solução do problema 2 (URLs persistentes no storage), o áudio terá URLs estáveis.

## Mudanças no Código

### Arquivos Modificados

1. **`src/components/whatsapp/chat/ChatMessages.tsx`** (linhas 49-50): Envolver o `ScrollArea` em um div com `flex-1 min-h-0 overflow-hidden` para garantir constraint de altura correto.

2. **`src/components/whatsapp/chat/MediaContent.tsx`** (linha 22): Mudar `preload="none"` para `preload="metadata"` no elemento `<audio>`.

3. **`supabase/functions/send-whatsapp-message/index.ts`**: Adicionar lógica para upload de base64 para Supabase Storage antes de enviar para Evolution API, salvando o path do storage como `media_url` persistente.

4. **`src/components/whatsapp/hooks/useWhatsAppSend.ts`** (linhas 36-37): No optimistic update, gerar uma URL local temporária para `mediaBase64` para que o preview apareça imediatamente.

## Impacto
- **UI**: Scrollbar e input sempre visíveis; mídias enviadas aparecem imediatamente
- **Estado**: Optimistic updates incluem preview de mídia
- **Edge Function**: Upload para storage garante URLs permanentes
- **DB**: `media_url` conterá paths do Supabase Storage em vez de URLs temporárias do WhatsApp

## Testes Manuais
1. Abrir conversa com muitas mensagens de mídia → scrollbar e input visíveis
2. Enviar áudio → aparece imediatamente para o remetente com player funcional
3. Enviar imagem/documento → aparece para o remetente
4. Ouvir áudio → mostra duração correta, ao atualizar página mantém

