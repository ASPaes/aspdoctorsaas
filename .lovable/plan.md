

# Plano: Recriar estrutura multi-tenant conforme novo schema

## Situacao atual

As tabelas `tenants`, `profiles` e `invites` ja existem (criadas na migracao anterior), mas estao **vazias** e com schema diferente do que voce quer agora.

### Diferencas encontradas

| Tabela | Atual | Desejado |
|---|---|---|
| **tenants** | `slug` (NOT NULL, UNIQUE), `ativo` (bool), `updated_at` | `plano` (nullable), `status` (default 'ativo'), sem slug/ativo/updated_at |
| **profiles** | PK = `id` (uuid separado), `user_id` + UNIQUE(user_id,tenant_id), role default 'user', status default 'active' | PK = `user_id`, sem `id` separado, role default 'admin', status default 'ativo' |
| **invites** | `invited_by`, `status`, UNIQUE(tenant_id,email) | `token` (uuid), `used_at`, sem invited_by/status |

As funcoes `current_tenant_id()` e `is_super_admin()` existem mas com `SECURITY DEFINER` e `SET search_path` -- o novo SQL as simplifica (sem SECURITY DEFINER).

## Migracao SQL

Uma unica migracao que:

1. **DROP** as 3 tabelas (seguro pois estao vazias)
2. **DROP** o trigger `set_tenants_updated_at` (depende da tabela antiga)
3. **Recria** as tabelas com o schema exato do seu SQL
4. **Recria** os indices
5. **Substitui** as funcoes `current_tenant_id()` e `is_super_admin()`

```sql
-- Drop dependencias
DROP TRIGGER IF EXISTS set_tenants_updated_at ON public.tenants;

-- Drop tabelas (vazias, sem risco)
DROP TABLE IF EXISTS public.invites CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.tenants CASCADE;

-- 1) EXT
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2) TENANTS
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  plano text NULL,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3) PROFILES (1 user -> 1 tenant)
CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin',
  is_super_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_tenant_id ON public.profiles(tenant_id);

-- 4) INVITES
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'viewer',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invites_tenant_id ON public.invites(tenant_id);
CREATE INDEX idx_invites_token ON public.invites(token);

-- 5) FUNCOES
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT p.tenant_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(p.is_super_admin, false)
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1
$$;
```

## O que NAO muda

- Nenhuma tabela de negocio e alterada
- Nenhum codigo frontend e modificado
- O app continua funcionando exatamente como antes

## Atualizacao de tipos

Apos a migracao, o arquivo `src/integrations/supabase/types.ts` sera atualizado automaticamente para refletir o novo schema.

