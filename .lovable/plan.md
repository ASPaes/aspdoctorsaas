

## Avaliacao: Recursos do ASP Chat ausentes neste projeto

Comparei componente a componente os dois projetos. Abaixo esta o mapa completo do que existe no **ASP Chat** e **nao existe** neste projeto:

---

### 1. ChatInput - Recursos ausentes

| Recurso | ASP Chat | Este projeto |
|---------|----------|-------------|
| **Emoji Picker** (EmojiPickerButton) | Sim | Nao |
| **Upload de Midia** (MediaUploadButton) - imagens, documentos, video | Sim | Nao |
| **Compositor IA** (AIComposerButton) - expandir, reformular, tom | Sim | Nao |
| **Gravacao de Audio** (AudioRecorder) - gravar e enviar audio | Sim | Nao |
| **Sugestoes de Macro** (/macro: comando) | Sim | Nao |
| **Sugestoes Inteligentes IA** (SmartReplySuggestions) - 3 tons | Sim | Nao |
| **Botao Microfone** quando campo vazio | Sim | Nao |
| **Dica "Enter para enviar"** | Sim | Nao |

### 2. ChatHeader - Recursos ausentes

| Recurso | ASP Chat | Este projeto |
|---------|----------|-------------|
| **Sentimento IA no header** (SentimentCard com emoji) | Sim | Nao |
| **Botao "Analisar"** sentimento | Sim | Nao |
| **Topic Badges** no header (Suporte, Acesso, etc.) | Sim | Nao |
| **Indicador de Fila** (QueueIndicator - "Na Fila") | Sim | Nao |
| **Botao "Assumir"** conversa da fila | Sim | Nao |
| **Botao "Transferir"** para outro agente | Sim | Nao |
| **Editar contato** inline (EditContactModal) | Sim | Nao |
| **Link para Settings** | Sim | Nao |

### 3. Details Sidebar - Recursos ausentes

| Recurso | ASP Chat | Este projeto |
|---------|----------|-------------|
| **Sentimento IA completo** (ConversationSentiment) | Parcial | Sim (basico) |
| **Topicos IA** (ConversationTopics + Recategorizar) | Sim | Nao |
| **Resumos IA** (ConversationSummaries) | Parcial | Sim (basico) |
| **Observacoes/Notas** (ConversationNotes) | Sim | Sim |

### 4. Edge Functions ausentes

| Edge Function | Descricao |
|--------------|-----------|
| `analyze-whatsapp-sentiment` | Analise de sentimento com IA |
| `categorize-whatsapp-conversation` | Categorizacao automatica de topicos |
| `compose-whatsapp-message` | Compositor IA (expandir, reformular, tom) |
| `generate-conversation-summary` | Gerar resumo da conversa |
| `suggest-smart-replies` | Sugestoes inteligentes de resposta |

### 5. Hooks presentes mas sem uso efetivo

Os hooks ja existem neste projeto (`useSmartReply`, `useWhatsAppComposer`, `useWhatsAppSentiment`, `useCategorizeConversation`), mas **os componentes de UI que os consomem nao foram criados**. As Edge Functions correspondentes tambem nao existem.

---

## Plano de Implementacao

Dado o volume, sugiro implementar em **fases priorizadas**:

### Fase 1 - ChatInput Completo (maior impacto UX)
1. Criar `SmartReplySuggestions` - cards com 3 tons (Amigavel, Formal, Direto)
2. Criar `EmojiPickerButton` - seletor de emojis
3. Criar `MediaUploadButton` - upload de imagens/documentos
4. Criar `AIComposerButton` - compositor com acoes de IA
5. Criar `AudioRecorder` - gravacao de audio
6. Integrar tudo no `ChatInput.tsx` existente

### Fase 2 - ChatHeader enriquecido
1. Adicionar `SentimentCard` com emoji no header
2. Adicionar `TopicBadges` no header
3. Adicionar `QueueIndicator` + botoes Assumir/Transferir
4. Adicionar `EditContactModal` inline

### Fase 3 - Details Sidebar completa
1. Criar `ConversationTopics` com recategorizacao
2. Melhorar `ConversationSentiment` com card visual completo

### Fase 4 - Edge Functions de IA
1. Criar `analyze-whatsapp-sentiment`
2. Criar `suggest-smart-replies`
3. Criar `compose-whatsapp-message`
4. Criar `categorize-whatsapp-conversation`
5. Criar `generate-conversation-summary`

### Detalhes tecnicos
- Os **hooks** ja existem e estao prontos para uso
- Os componentes seguirao o mesmo padrao visual do ASP Chat (screenshot de referencia)
- Edge Functions usarao **Lovable AI Gateway** (`LOVABLE_API_KEY`) para funcionalidades de IA
- Componentes serao criados em `src/components/whatsapp/chat/` seguindo a estrutura existente

### Documentacao a atualizar
- `PROJECT_REQUIREMENTS.md` - novos recursos WhatsApp
- `architecture.md` - novas Edge Functions

**Aguardando OK para iniciar a implementacao. Qual fase deseja priorizar?**

