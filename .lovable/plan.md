

## Objetivo
Adicionar configuração de fuso horário nas configurações do Chat (WhatsApp), com padrão "America/Sao_Paulo" (Brasília). O fuso será usado para exibição de timestamps nas mensagens e conversas.

## Abordagem

### 1. Banco de Dados
Adicionar coluna `chat_timezone` (text, default `'America/Sao_Paulo'`) na tabela `whatsapp_instances`. Cada instância poderá ter seu fuso configurado. Alternativa: adicionar na tabela `configuracoes` como configuração global do tenant.

**Recomendação**: Adicionar na tabela `configuracoes` como `chat_timezone text NOT NULL DEFAULT 'America/Sao_Paulo'` — é uma configuração global do tenant, não por instância.

### 2. UI — Nova seção no SecuritySettingsTab ou sub-tab dedicada
Adicionar um seletor de fuso horário nas configurações do WhatsApp. Opções:
- Dropdown com fusos brasileiros comuns (America/Sao_Paulo, America/Manaus, America/Recife, America/Rio_Branco, America/Noronha)
- Ou lista completa de fusos IANA

Será adicionado como um card na sub-tab "Setup" ou "Segurança" das configurações do WhatsApp.

### 3. Frontend — Aplicar fuso na exibição
- Criar um hook `useChatTimezone()` que busca o fuso do tenant via tabela `configuracoes`
- Usar `date-fns-tz` (ou conversão manual com `Intl.DateTimeFormat`) para formatar timestamps nos componentes:
  - `MessageBubble.tsx` (horário HH:mm)
  - `ChatMessages.tsx` (agrupamento por data dd/MM/yyyy)
  - `ChatArea.tsx` (mesmo padrão)
  - `ConversationItem.tsx` (tempo relativo)

**Nota**: O `date-fns` nativo não suporta fusos. Usaremos `Intl.DateTimeFormat` com a opção `timeZone` para evitar dependência extra.

### 4. Arquivos impactados

**Banco de dados (migration)**:
- `ALTER TABLE configuracoes ADD COLUMN chat_timezone text NOT NULL DEFAULT 'America/Sao_Paulo'`

**Novos arquivos**:
- `src/hooks/useChatTimezone.ts` — hook para buscar e cachear o fuso
- `src/lib/formatDateWithTimezone.ts` — helpers de formatação com fuso

**Arquivos modificados**:
- `src/components/configuracoes/whatsapp/SetupGuideCollapsible.tsx` ou criar seção no setup — adicionar seletor de fuso
- `src/components/whatsapp/chat/MessageBubble.tsx` — usar formatação com fuso
- `src/components/whatsapp/chat/ChatMessages.tsx` — usar formatação com fuso
- `src/components/whatsapp/ChatArea.tsx` — usar formatação com fuso
- `src/components/whatsapp/conversations/ConversationItem.tsx` — usar formatação com fuso

### 5. Testes manuais
1. Acessar Configurações > WhatsApp > Setup
2. Alterar o fuso horário para um diferente (ex: America/Manaus)
3. Verificar que os horários das mensagens no chat mudam conforme o fuso selecionado
4. Voltar para America/Sao_Paulo e confirmar que volta ao normal

