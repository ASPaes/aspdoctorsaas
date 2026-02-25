
-- 1) Tornar funções SECURITY DEFINER (evita recursão ao consultar profiles com RLS)
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
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
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p.is_super_admin, false)
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1
$$;

-- 2) Dropar policies antigas (auth_read_* / auth_write_*)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clientes','cs_tickets','movimentos_mrr','certificado_a1_vendas',
    'cliente_contatos','cs_ticket_updates','cs_ticket_reassignments',
    'configuracoes','funcionarios',
    'segmentos','areas_atuacao','modelos_contrato','fornecedores','produtos',
    'formas_pagamento','motivos_cancelamento','origens_venda','unidades_base',
    'estados','cidades','clientes_old_import'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS auth_read_%I ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS auth_write_%I ON public.%I', t, t);
  END LOOP;
  -- Nomes especiais
  DROP POLICY IF EXISTS auth_read_verticais ON public.modelos_contrato;
  DROP POLICY IF EXISTS auth_write_verticais ON public.modelos_contrato;
  DROP POLICY IF EXISTS auth_read_cs_reassignments ON public.cs_ticket_reassignments;
  DROP POLICY IF EXISTS auth_write_cs_reassignments ON public.cs_ticket_reassignments;
  DROP POLICY IF EXISTS auth_read_cs_ticket_updates ON public.cs_ticket_updates;
  DROP POLICY IF EXISTS auth_write_cs_ticket_updates ON public.cs_ticket_updates;
END $$;

-- 3) Habilitar RLS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentos_mrr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificado_a1_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_contatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_ticket_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cs_ticket_reassignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.funcionarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segmentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.areas_atuacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modelos_contrato ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornecedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.formas_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motivos_cancelamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.origens_venda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unidades_base ENABLE ROW LEVEL SECURITY;

-- 4) PROFILES: usuário vê o próprio; super admin vê todos
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;
CREATE POLICY profiles_self_read ON public.profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS profiles_self_write ON public.profiles;
CREATE POLICY profiles_self_write ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_super_admin());

-- INSERT em profiles (necessário para onboarding/signup)
DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_super_admin());

-- 5) TENANTS: leitura do próprio tenant; super admin vê todos
DROP POLICY IF EXISTS tenants_read ON public.tenants;
CREATE POLICY tenants_read ON public.tenants FOR SELECT TO authenticated
  USING (id = public.current_tenant_id() OR public.is_super_admin());

-- 6) INVITES: admin do tenant ou super admin
DROP POLICY IF EXISTS invites_tenant_rw ON public.invites;
CREATE POLICY invites_tenant_rw ON public.invites FOR ALL TO authenticated
  USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
  WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin());

-- 7) Tabelas transacionais com tenant_id
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clientes','cs_tickets','movimentos_mrr','certificado_a1_vendas',
    'cliente_contatos','cs_ticket_updates','cs_ticket_reassignments',
    'configuracoes','funcionarios'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %s_tenant_rw ON public.%I', t, t);
    EXECUTE format($sql$
      CREATE POLICY %s_tenant_rw ON public.%I FOR ALL TO authenticated
      USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
      WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin())
    $sql$, t, t);
  END LOOP;
END $$;

-- 8) Catálogos com tenant_id
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'segmentos','areas_atuacao','modelos_contrato','fornecedores','produtos',
    'formas_pagamento','motivos_cancelamento','origens_venda','unidades_base'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %s_tenant_rw ON public.%I', t, t);
    EXECUTE format($sql$
      CREATE POLICY %s_tenant_rw ON public.%I FOR ALL TO authenticated
      USING (tenant_id = public.current_tenant_id() OR public.is_super_admin())
      WITH CHECK (tenant_id = public.current_tenant_id() OR public.is_super_admin())
    $sql$, t, t);
  END LOOP;
END $$;

-- 9) Tabelas globais (estados, cidades) - somente leitura para authenticated
ALTER TABLE public.estados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cidades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estados_read ON public.estados;
CREATE POLICY estados_read ON public.estados FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cidades_read ON public.cidades;
CREATE POLICY cidades_read ON public.cidades FOR SELECT TO authenticated USING (true);

-- 10) clientes_old_import - somente super admin
ALTER TABLE public.clientes_old_import ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS old_import_super ON public.clientes_old_import;
CREATE POLICY old_import_super ON public.clientes_old_import FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
