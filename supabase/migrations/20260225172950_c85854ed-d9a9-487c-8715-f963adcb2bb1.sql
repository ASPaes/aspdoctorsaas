
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
