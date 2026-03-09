

## Objetivo

Duas mudanças interligadas:

1. **Segurança** -- Replicar o modelo do ASP Chat com toggles de "Exigir Aprovação para Novas Contas" e "Restrição de Domínio de Email" (com gestão de domínios permitidos). No ASP Chat isso usa uma tabela `project_config` (key-value). Este projeto não tem essa tabela, então precisamos criá-la.

2. **Vínculo Usuário ↔ Funcionário** -- Adicionar `funcionario_id` na tabela `profiles` para que cada usuário do sistema seja associado a um funcionário cadastrado. Isso permite que na aba **Equipe** apareça automaticamente o cargo/função, e na aba **Usuários** o admin possa vincular cada usuário a um funcionário.

## Mudanças no Banco de Dados (Migration)

```sql
-- 1. Tabela project_config para configurações de segurança
CREATE TABLE IF NOT EXISTS public.project_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);
ALTER TABLE project_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_config FORCE ROW LEVEL SECURITY;
CREATE POLICY "project_config_tenant_access" ON project_config
  FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id))
  WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_project_config BEFORE INSERT ON project_config
  FOR EACH ROW EXECUTE FUNCTION set_tenant_id_on_insert();

-- 2. Adicionar funcionario_id ao profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS funcionario_id bigint REFERENCES funcionarios(id);
```

## Mudanças no Código

### 1. `src/hooks/useSecuritySettings.ts` (Novo)
Hook baseado no ASP Chat que lê/escreve `project_config` com keys:
- `require_account_approval` (boolean)
- `restrict_signup_by_domain` (boolean)
- `allowed_email_domains` (comma-separated string)

Adaptado para multi-tenant (filtra por `tenant_id`).

### 2. `src/components/configuracoes/whatsapp/SecuritySettingsTab.tsx` (Reescrever)
Substituir o conteúdo atual (cards informativos) pelo layout do ASP Chat:
- Toggle "Exigir Aprovação para Novas Contas"
- Toggle "Restrição de Domínio de Email" + campo para adicionar/remover domínios
- Alerta informativo sobre primeiro admin

### 3. `src/hooks/useTenantUsers.ts` (Modificar)
- Atualizar `get_tenant_users_with_email` RPC ou criar query separada para incluir `funcionario_id` no retorno de `TenantProfile`.
- Adicionar mutation `useUpdateUserFuncionario` para vincular `profiles.funcionario_id`.

### 4. `src/components/configuracoes/UsuariosTab.tsx` e `src/pages/SettingsUsers.tsx` (Modificar)
- Adicionar coluna "Funcionário" na tabela de usuários com um Select dropdown listando funcionários do tenant.
- Ao selecionar, chama mutation para atualizar `profiles.funcionario_id`.

### 5. `src/components/configuracoes/whatsapp/TeamTab.tsx` (Modificar)
- Em vez de mostrar só email e role, buscar o `funcionario_id` vinculado ao profile e exibir nome e **cargo** do funcionário.

### 6. `src/integrations/supabase/types.ts` (Atualizar)
- Adicionar tipagem de `project_config` e `funcionario_id` em profiles.

### 7. RPC `get_tenant_users_with_email` (Atualizar via migration)
- Adicionar `p.funcionario_id` ao retorno da função para que o frontend tenha acesso ao vínculo.

## Impacto em Segurança
- Nova tabela `project_config` com RLS via `can_access_tenant_row`
- `funcionario_id` em profiles é nullable (vínculo opcional)
- Sem exposição de dados sensíveis

## Testes Manuais
1. Configurações > WhatsApp > Segurança: ativar/desativar toggles, adicionar domínios
2. Configurações > Usuários: vincular usuário a funcionário
3. Configurações > WhatsApp > Equipe: verificar que cargo aparece automaticamente

