

## Objetivo
Quando o usuário clicar no botão WhatsApp no cadastro do cliente, em vez de abrir o WhatsApp Web externo, o sistema deve navegar para o módulo de Chat (`/whatsapp`) e abrir/criar uma conversa vinculada ao cliente. Além disso, ao vincular um número pelo chat, o contato deve ser automaticamente adicionado nos contatos do cliente.

## Mudanças no Código

### 1. `src/components/clientes/DadosClienteTab.tsx`
- Remover o link `<a href={whatsappHref}>` e substituir por um `<Button onClick>` que navega para `/whatsapp?phone={telefone}&clienteId={clienteId}&clienteName={nome}`
- Importar `useNavigate` do react-router-dom
- Receber `clienteId` e dados do cliente (razao_social/nome_fantasia) como props (já recebe `clienteId`)

### 2. `src/pages/WhatsApp.tsx`
- Ler query params (`phone`, `clienteId`, `clienteName`) da URL via `useSearchParams`
- Quando esses params existirem, auto-criar ou encontrar conversa existente com aquele número, vinculada ao `clienteId` via metadata
- Selecionar automaticamente a conversa criada/encontrada
- Limpar os query params após processar

### 3. `src/components/whatsapp/hooks/useCreateConversation.ts`
- Aceitar `clienteId` opcional nos params
- Quando `clienteId` for fornecido, salvar `{ cliente_id: clienteId }` no metadata da conversa automaticamente

### 4. Novo hook/lógica: Auto-adicionar contato ao cliente
- Quando uma conversa for vinculada a um `cliente_id` (via metadata), verificar se o telefone já existe em `cliente_contatos` para aquele cliente
- Se não existir, inserir automaticamente um registro em `cliente_contatos` com o telefone e nome do contato WhatsApp

### 5. `src/components/whatsapp/hooks/useClienteLinkSuggestion.ts`
- No `linkMutation.onSuccess`, adicionar lógica para inserir o telefone do contato em `cliente_contatos` se não existir

## Impacto em Segurança
- Sem mudanças em RLS (usa tabelas existentes com RLS já configurado)
- Dados transitam via query params na URL (apenas IDs e telefone, sem dados sensíveis)

## Fluxo
```text
ClienteForm → click botão WhatsApp
  → navigate("/whatsapp?phone=5547...&clienteId=uuid&clienteName=Empresa")
  → WhatsApp page detecta params
  → Cria/encontra conversa com phone + vincula cliente_id no metadata
  → Auto-insere telefone em cliente_contatos (se não existe)
  → Seleciona a conversa automaticamente
```

## Testes Manuais
1. Abrir cadastro de cliente com WhatsApp preenchido
2. Clicar no botão de WhatsApp → deve navegar para `/whatsapp` e abrir conversa
3. Verificar que metadata tem `cliente_id`
4. Verificar que telefone aparece nos contatos adicionais do cliente

