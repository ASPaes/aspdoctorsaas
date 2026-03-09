## Objetivo

Integrar a tabela `clientes` ao fluxo de WhatsApp para: (1) buscar clientes pelo telefone ao criar nova conversa, (2) permitir criar conversa com numero avulso, e (3) sugerir vincular contatos WhatsApp a clientes existentes quando o numero bate.

## Mudancas no Codigo

### 1. NewConversationModal - Busca de clientes

**Arquivo**: `src/components/whatsapp/conversations/NewConversationModal.tsx`

- Adicionar campo de busca que consulta `clientes` por `telefone_whatsapp`, `razao_social`, `nome_fantasia ou` **codigo_sequencial**
- Exibir lista de resultados com nome fantasia/razao social e telefone
- Ao selecionar um cliente, preencher automaticamente telefone e nome
- Manter opcao de digitar numero manualmente (aba ou toggle: "Buscar Cliente" / "Numero Avulso")
- Ao criar conversa a partir de um cliente, salvar `cliente_id` no metadata da conversa
- Um cliente pode ter vários contatos amarrados á ele. 

### 2. Hook useClienteSearch

**Arquivo novo**: `src/components/whatsapp/hooks/useClienteSearch.ts`

- Query na tabela `clientes` filtrando por `telefone_whatsapp ilike`, `razao_social ilike` ou `nome_fantasia ilike`
- Filtro por `tenant_id` via contexto
- Debounce de 300ms no termo de busca
- Retorna `id`, `razao_social`, `nome_fantasia`, `telefone_whatsapp`, `cnpj`

### 3. Sugestao de vinculacao na DetailsSidebar

**Arquivo**: `src/components/whatsapp/chat/DetailsSidebar.tsx`

- Ao abrir detalhes de uma conversa, verificar se o `phone_number` do contato WhatsApp bate com algum `telefone_whatsapp` na tabela `clientes` (normalizando digitos)
- Se encontrar match e nao houver vinculo, exibir card de sugestao: "Este contato parece ser o cliente **X**. Vincular?"
- Botao "Vincular" salva o `cliente_id` no campo `metadata` da conversa (`metadata.cliente_id`)
- Se ja vinculado, exibir o nome do cliente como link

### 4. Hook useClienteLinkSuggestion

**Arquivo novo**: `src/components/whatsapp/hooks/useClienteLinkSuggestion.ts`

- Recebe `phoneNumber` do contato WhatsApp
- Normaliza e busca na tabela `clientes` por `telefone_whatsapp` com digitos iguais
- Retorna cliente sugerido ou null
- Funcao `linkCliente(conversationId, clienteId)` que faz update no metadata da conversa

### 5. Componente ClienteLinkCard

**Arquivo novo**: `src/components/whatsapp/chat/ClienteLinkCard.tsx`

- Card compacto exibido na DetailsSidebar
- Mostra nome do cliente sugerido + botao vincular
- Se ja vinculado, mostra nome do cliente vinculado com badge "Vinculado"
- Permite desvincular

## Impacto em Seguranca

- **RLS**: Tabela `clientes` ja tem RLS via `can_access_tenant_row` - nenhuma mudanca necessaria
- Nao ha criacao de tabelas novas; usa campo `metadata` (jsonb) existente em `whatsapp_conversations`

## Documentacao a Atualizar

- `PROJECT_REQUIREMENTS.md` - vinculacao clientes/WhatsApp

## Testes Manuais

1. Abrir modal "Nova Conversa" e buscar por nome de cliente existente
2. Selecionar cliente, verificar que telefone e nome preenchem automaticamente
3. Criar conversa com numero avulso (sem selecionar cliente)
4. Abrir conversa cujo numero bate com um cliente - verificar sugestao de vinculacao
5. Clicar "Vincular" e confirmar que o card muda para "Vinculado"