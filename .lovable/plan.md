

# Plano: Estrutura de Multi-Tenancy

## Objetivo

Criar as tabelas e funcoes auxiliares para suportar multi-tenant sem habilitar RLS e sem quebrar o app atual.

## Migracoes SQL

Uma unica migracao com:

### 1. Tabela `public.tenants`

```sql
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  slug text UNIQUE NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 2. Tabela `public.profiles`

```sql
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user',
  is_super_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);
```

### 3. Tabela `public.invites`

```sql
CREATE TABLE public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
```

### 4. Funcao `current_tenant_id()`

```sql
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id
  FROM public.profiles
  WHERE user_id = auth.uid()
    AND status = 'active'
  LIMIT 1
$$;
```

### 5. Funcao `is_super_admin()`

```sql
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_super_admin
     FROM public.profiles
     WHERE user_id = auth.uid()
       AND status = 'active'
     LIMIT 1),
    false
  )
$$;
```

### 6. Trigger `updated_at` no `tenants`

Reutiliza a funcao `set_updated_at()` ja existente:

```sql
CREATE TRIGGER set_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

## O que NAO muda

- Nenhuma tabela existente e alterada (sem `tenant_id` adicionado agora).
- RLS nao e habilitado nestas novas tabelas.
- Nenhum codigo frontend e modificado.
- O app continua funcionando exatamente como antes.

## Arquivo

| Recurso | Acao |
|---|---|
| Migracao SQL | Cria `tenants`, `profiles`, `invites`, `current_tenant_id()`, `is_super_admin()` |

## Proximos passos (fora deste plano)

1. Adicionar `tenant_id` nas tabelas de negocio (`clientes`, `movimentos_mrr`, etc.).
2. Habilitar RLS com policies usando `current_tenant_id()`.
3. Criar trigger para auto-criar profile ao cadastrar usuario.
4. Atualizar frontend para lidar com contexto de tenant.

