

## Objetivo
Portar todas as subpáginas e componentes do projeto ASP Chat para o Doctor SaaS, substituindo a implementação básica atual por uma versão completa com todas as funcionalidades.

---

## Inventário do ASP Chat (o que precisa ser portado)

O projeto ASP Chat possui **~100+ arquivos** organizados em:

```text
Páginas (4):
  /whatsapp          → Chat principal (Sidebar + Chat + Details)
  /whatsapp/settings → Setup, Instâncias, Macros, Atribuição, Equipe, Segurança
  /whatsapp/contatos → Gestão de contatos com métricas e análises
  /whatsapp/relatorio → Dashboard de métricas e relatórios

Hooks (25): useWhatsAppConversations, useWhatsAppMessages, useWhatsAppSend,
  useWhatsAppInstances, useWhatsAppContacts, useWhatsAppMetrics,
  useWhatsAppMacros, useWhatsAppSentiment, useWhatsAppComposer,
  useWhatsAppMessageSearch, useWhatsAppActions, useCreateConversation,
  useConversationAssignment, useConversationNotes, useConversationSummaries,
  useConversationTopics, useCategorizeConversation, useContactDetails,
  useAssignmentRules, useMessageReactions, useMessageReaction,
  useMessageEditHistory, useEditMessage, useSmartReply

Componentes (~75):
  conversations/ (11): Sidebar, Item, Filters, NewModal, QuickPills, etc.
  chat/ (16): ChatArea, Header, MessageBubble, Reactions, Edit, etc.
  chat/details/ (4): DetailsSidebar, Notes, Sentiment, Summaries
  chat/input/ (9): InputContainer, MediaUpload, AudioRecorder, Emoji, Macros, etc.
  chat/topics/ (3): Topics, TopicBadges, TopicsDistributionChart
  contacts/ (9): Sidebar, Details, Header, Metrics, History, Sentiment, etc.
  reports/ (16): MetricCard, DateRange, Charts (8 tipos), Tables, Toolbar
  settings/ (14): Instances, Teams, Assignment, Security, Setup
  macros/ (3): Manager, Dialog
  notifications/ (2): Banner, Toggle

Utils (8): timeFormatters, phoneUtils, contactUtils, exportConversation, etc.
Constants (1): conversationTopics
```

---

## Plano de Implementação — Dividido em 5 Sub-fases

Devido ao volume (~100 arquivos), a implementação será feita em etapas incrementais, cada uma entregando valor funcional.

### Sub-fase 2B.1: Hooks + Utils Foundation
Portar todos os 25 hooks WhatsApp e 8 utils do ASP Chat, adaptando para multi-tenancy (usando `useTenantFilter` em vez do AuthContext do ASP Chat). Estes são a base para todos os componentes.

**Adaptações necessárias:**
- Substituir `useAuth()` do ASP Chat por `useTenantFilter()` / `useProfile()` do Doctor SaaS
- Manter queries compatíveis com as tabelas já criadas na Fase 1
- Adaptar imports do Supabase client

**Arquivos:** ~33 novos em `src/components/whatsapp/hooks/` e `src/utils/whatsapp/`

### Sub-fase 2B.2: Chat Completo (substituir implementação atual)
Reescrever a página `/whatsapp` com todos os componentes do ASP Chat:
- **ConversationsSidebar**: filtros avançados, busca no histórico, paginação, quick pills, nova conversa
- **ChatArea completo**: header com status/sentimento, message bubbles com reações, edição, reply, media viewer
- **ChatInput completo**: upload de mídia, áudio, emoji picker, macros, reply preview
- **ConversationDetailsSidebar**: notas, resumos, sentimento, tópicos
- **Mobile responsive**: sidebar/chat toggle

**Arquivos:** ~45 novos/modificados em `src/components/whatsapp/`

### Sub-fase 2B.3: Página de Contatos (/whatsapp/contatos)
- **ContactsSidebar**: lista com busca, filtros, ordenação
- **ContactDetails**: métricas, histórico de conversas, evolução de sentimento, resumos, tópicos

**Arquivos:** ~10 novos

### Sub-fase 2B.4: Página de Relatórios (/whatsapp/relatorio)
- Dashboard completo com 15+ métricas (conversas, mensagens, operacionais, engajamento)
- 8 tipos de gráficos (evolução, status, sentimento, tópicos, horário, dia da semana, agentes, instâncias)
- Filtros por período, instância, agente
- Export para CSV

**Arquivos:** ~18 novos

### Sub-fase 2B.5: Página de Configurações (/whatsapp/settings)
Expandir a tab existente em Configurações para uma página dedicada com:
- Setup guide
- Gestão de instâncias (já parcialmente implementado)
- Macros (atalhos de mensagem)
- Regras de atribuição automática
- Gestão de equipe (adaptar para usar sistema de profiles do Doctor SaaS)
- Configurações de segurança

**Arquivos:** ~20 novos

---

## Roteamento
Adicionar no `App.tsx` dentro do layout protegido:
```text
/whatsapp           → WhatsApp (chat principal)
/whatsapp/settings  → WhatsAppSettings
/whatsapp/relatorio → WhatsAppRelatorio
/whatsapp/contatos  → WhatsAppContatos
```

## Navegação
A sidebar do chat (ConversationsSidebar) inclui links para todas as subpáginas via ícones no header.

---

## Decisão: Qual sub-fase implementar primeiro?

Sugiro começar pela **Sub-fase 2B.1 (Hooks + Utils)** seguida da **2B.2 (Chat Completo)**, pois são a base para tudo. Posso implementar nessa ordem ou você prefere priorizar outra sub-fase?

