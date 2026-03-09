

## Objetivo

Adicionar abas "Equipe" e "Segurança" nas configurações do WhatsApp, adaptadas ao modelo de dados deste projeto (que usa `funcionarios` + `profiles` em vez de um único `profiles` com `full_name`).

## Análise do Modelo de Dados

No ASP Chat, a equipe vem de `profiles` (com `full_name`, `is_active`, `is_approved`). Neste projeto:
- **Funcionários** (`funcionarios`): tabela com `nome`, `email`, `cargo`, `ativo`, `tenant_id`
- **Profiles** (`profiles`): tabela auth com `user_id`, `role`, `status`, `access_status`
- Não existe tabela `project_config` para configurações de segurança

### Decisão de Design: Equipe

A aba "Equipe" mostrará os **funcionários ativos** do tenant como agentes do WhatsApp. Colunas:
- Nome / Email / Cargo
- Status (ativo/inativo)
- Conversas ativas (count de `whatsapp_conversations.assigned_to` — mas `assigned_to` é `uuid` de profiles, não `bigint` de funcionarios)

**Problema identificado**: `whatsapp_conversations.assigned_to` referencia `uuid` (profiles.user_id), mas funcionários usa `bigint` id. A aba de equipe deve mostrar os **usuários do tenant** (profiles + email via RPC) com informação de quantas conversas cada um tem atribuídas, similar ao ASP Chat.

### Decisão de Design: Segurança

Para segurança, o ASP Chat usa `project_config` (key-value). Este projeto já tem `allowed_domain` no `profiles` e a aba "Aprovação de Acessos" em Configurações. Podemos criar um componente simplificado de segurança sem necessidade de nova tabela — usando o `allowed_domain` já existente no profile do admin.

## Mudanças no Código

### Arquivos Criados

1. **`src/components/configuracoes/whatsapp/TeamTab.tsx`**
   - Lista usuários do tenant via `useTenantUsers()` (hook já existente)
   - Mostra: Avatar/iniciais, nome, email, role, status
   - Conta conversas ativas por `assigned_to` (uuid)
   - Sem botão de convidar (usa o sistema de convites existente em Configurações > Usuários)

2. **`src/components/configuracoes/whatsapp/SecuritySettingsTab.tsx`**
   - Configuração de domínio permitido (usa `allowed_domain` do profile admin)
   - Toggle de aprovação de acessos (informativo, redireciona para aba de Aprovação de Acessos)
   - Sem necessidade de nova tabela

### Arquivos Modificados

3. **`src/pages/Configuracoes.tsx`** (WhatsAppSettingsContent)
   - Adicionar abas "Equipe" e "Segurança" no TabsList
   - Renderizar condicionalmente (apenas admins)

4. **`src/pages/WhatsAppSettings.tsx`**
   - Adicionar as mesmas abas para consistência

## Impacto em Segurança
- Sem novas tabelas ou migrations necessárias
- Usa hooks e dados já protegidos por RLS (`useTenantUsers`, `whatsapp_conversations`)

## Testes Manuais
1. Abrir Configurações > WhatsApp > Equipe
2. Verificar lista de membros do tenant com conversas ativas
3. Abrir aba Segurança e verificar configurações de domínio

