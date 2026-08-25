-- Permissão de adicionar/cancelar módulo do cliente, por USUÁRIO.
--
-- O RBAC do projeto resolve permissão por papel: role_permissions (padrão
-- global) com override em tenant_role_permissions. Papel não descreve o pedido
-- da Digi Office — Pedro é admin e Fabianne é head, e há mais 3 admins e 8 heads
-- no mesmo tenant que devem ficar de fora.
--
-- Entra uma terceira camada, acima das duas, com a mesma forma das outras:
-- user_permissions. Precedência final vira usuário > tenant > padrão global.
--
-- Nada muda fora da Digi Office: o padrão global do recurso novo nasce liberado
-- para os 3 papéis, que é o comportamento de hoje.
--
-- Este arquivo é só o portão de dados. A checagem continua sendo de tela nesta
-- fase (usePermissions/ProtectedElement); RLS e RPCs ficam para a fase 2.

-- ---------------------------------------------------------------------------
-- 1. O recurso
-- ---------------------------------------------------------------------------
INSERT INTO public.resources
  (key, module, label, description, where_it_appears, parent_key, display_order, is_navigation, hidden)
SELECT
  'clientes.modulos',
  'Cadastro do Cliente',
  'Adicionar e cancelar módulos',
  'Libera os botões de escrita do card Produtos & Módulos: adicionar módulo, editar, inativar, excluir e cancelar.',
  'Ficha do cliente > Produtos & Módulos',
  'clientes',
  COALESCE((SELECT r.display_order + 1 FROM public.resources r WHERE r.key = 'clientes.custos'), 100),
  false,
  false
ON CONFLICT (key) DO UPDATE
  SET module           = EXCLUDED.module,
      label            = EXCLUDED.label,
      description      = EXCLUDED.description,
      where_it_appears = EXCLUDED.where_it_appears,
      parent_key       = EXCLUDED.parent_key;

-- ---------------------------------------------------------------------------
-- 2. Padrão global: liberado para todo mundo, que é como está hoje.
--    Sem isso, ligar o recurso tiraria os botões de head e user em Athuz, ASP,
--    Liberty e nos outros tenants com rbac_enabled = true.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
SELECT x.role, 'clientes.modulos', true, true, true, true
FROM (VALUES ('admin'), ('head'), ('user')) AS x(role)
ON CONFLICT (role, resource_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. A camada por usuário
--    Booleano NULO = "não opina", e a decisão cai para o papel. Só linha com
--    valor explícito manda.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_permissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_key text NOT NULL REFERENCES public.resources(key) ON DELETE CASCADE,
  can_view     boolean,
  can_insert   boolean,
  can_update   boolean,
  can_delete   boolean,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT user_permissions_user_id_resource_key_key UNIQUE (user_id, resource_key)
);

CREATE INDEX IF NOT EXISTS idx_up_lookup
  ON public.user_permissions (user_id, resource_key);

CREATE INDEX IF NOT EXISTS idx_up_tenant
  ON public.user_permissions (tenant_id, resource_key);

ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- Mesma forma das policies de tenant_role_permissions: super admin passa por
-- cima, o resto fica preso ao próprio tenant e escrever é coisa de admin.
DROP POLICY IF EXISTS up_select ON public.user_permissions;
CREATE POLICY up_select ON public.user_permissions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR tenant_id = (SELECT public.current_tenant_id())
  );

DROP POLICY IF EXISTS up_write ON public.user_permissions;
CREATE POLICY up_write ON public.user_permissions
  TO authenticated
  USING (
    (SELECT public.is_super_admin())
    OR (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_tenant_admin()))
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (tenant_id = (SELECT public.current_tenant_id()) AND (SELECT public.is_tenant_admin()))
  );

REVOKE ALL ON TABLE public.user_permissions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_permissions TO authenticated;
GRANT ALL ON TABLE public.user_permissions TO service_role;

COMMENT ON TABLE public.user_permissions IS
  'Exceção de permissão por usuário. Vence tenant_role_permissions e role_permissions. Booleano NULL = não opina.';

-- ---------------------------------------------------------------------------
-- 4. A resolução ganha a camada nova
--    Corpo idêntico ao de produção em 25/08/2026, com um LEFT JOIN e o COALESCE
--    estendido. Assinatura inalterada: CREATE OR REPLACE preserva os GRANTs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_permissions()
RETURNS TABLE(
  resource_key text, module text, label text, description text,
  where_it_appears text, is_navigation boolean, hidden boolean,
  parent_key text, display_order integer,
  can_view boolean, can_insert boolean, can_update boolean, can_delete boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_role text;
  v_is_super boolean;
  v_tenant_id uuid;
  v_rbac_enabled boolean;
BEGIN
  SELECT p.role, p.is_super_admin, p.tenant_id
  INTO v_role, v_is_super, v_tenant_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;

  IF v_is_super THEN
    RETURN QUERY
    SELECT r.key, r.module, r.label, r.description, r.where_it_appears,
           r.is_navigation, r.hidden, r.parent_key, r.display_order,
           true, true, true, true
    FROM public.resources r
    ORDER BY r.display_order;
    RETURN;
  END IF;

  IF v_role IS NULL OR v_tenant_id IS NULL THEN RETURN; END IF;

  SELECT t.rbac_enabled INTO v_rbac_enabled
  FROM public.tenants t WHERE t.id = v_tenant_id LIMIT 1;

  IF NOT COALESCE(v_rbac_enabled, false) THEN
    RETURN QUERY
    SELECT r.key, r.module, r.label, r.description, r.where_it_appears,
           r.is_navigation, r.hidden, r.parent_key, r.display_order,
           true, true, true, true
    FROM public.resources r
    ORDER BY r.display_order;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    r.key, r.module, r.label, r.description, r.where_it_appears,
    r.is_navigation, r.hidden, r.parent_key, r.display_order,
    COALESCE(up.can_view,   trp.can_view,   rp.can_view,   false),
    COALESCE(up.can_insert, trp.can_insert, rp.can_insert, false),
    COALESCE(up.can_update, trp.can_update, rp.can_update, false),
    COALESCE(up.can_delete, trp.can_delete, rp.can_delete, false)
  FROM public.resources r
  LEFT JOIN public.role_permissions rp
    ON rp.resource_key = r.key AND rp.role = v_role
  LEFT JOIN public.tenant_role_permissions trp
    ON trp.resource_key = r.key AND trp.role = v_role AND trp.tenant_id = v_tenant_id
  LEFT JOIN public.user_permissions up
    ON up.resource_key = r.key AND up.user_id = auth.uid()
  ORDER BY r.display_order;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Digi Office: trava os 3 papéis...
-- ---------------------------------------------------------------------------
INSERT INTO public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
SELECT '955178ba-b367-498d-8443-cc5b7d1ee163'::uuid, x.role, 'clientes.modulos', false, false, false, false
FROM (VALUES ('admin'), ('head'), ('user')) AS x(role)
ON CONFLICT (tenant_id, role, resource_key) DO UPDATE
  SET can_view = false, can_insert = false, can_update = false, can_delete = false,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 6. ...e libera as duas pessoas por cima da trava.
-- ---------------------------------------------------------------------------
INSERT INTO public.user_permissions
  (tenant_id, user_id, resource_key, can_view, can_insert, can_update, can_delete)
SELECT p.tenant_id, u.id, 'clientes.modulos', true, true, true, true
FROM auth.users u
JOIN public.profiles p ON p.user_id = u.id
WHERE lower(u.email) IN ('pedro@digioffice.com.br', 'fabianne@digioffice.com.br')
  AND p.tenant_id = '955178ba-b367-498d-8443-cc5b7d1ee163'::uuid
ON CONFLICT (user_id, resource_key) DO UPDATE
  SET can_view = true, can_insert = true, can_update = true, can_delete = true,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 7. Conferência: e-mail errado ou pessoa fora do tenant tem que estourar aqui,
--    não virar "salvou e ninguém ganhou nada".
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_liberados int;
BEGIN
  SELECT count(*) INTO v_liberados
  FROM public.user_permissions
  WHERE resource_key = 'clientes.modulos'
    AND tenant_id = '955178ba-b367-498d-8443-cc5b7d1ee163'::uuid
    AND can_view IS TRUE;

  IF v_liberados <> 2 THEN
    RAISE EXCEPTION 'Esperava 2 pessoas liberadas na Digi Office, encontrei %', v_liberados;
  END IF;
END $$;
