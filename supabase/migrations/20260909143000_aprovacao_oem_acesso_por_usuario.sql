-- ============================================================================
-- Aprovação OEM: o acesso passa a caber por pessoa, não só por papel.
--
-- Hoje `fn_oem_aprovacao_pode` é "super admin, ou admin do próprio tenant".
-- Quem cuida da fila na operação nem sempre é admin, e promover alguém a admin
-- por causa de UMA aba dá, de brinde, a tela de Configurações inteira.
--
-- Entra o mesmo desenho que já existe para `clientes.modulos` (migration
-- 20260825120000): um recurso em `resources`, padrão por papel em
-- `role_permissions`, e a exceção por pessoa em `user_permissions`, que vence
-- as duas. A coluna "Módulos" da tela de Acessos & permissões vira "Integração"
-- e passa a guardar os dois acessos.
--
-- NADA MUDA PARA QUEM JÁ TINHA. O padrão do papel nasce admin=true,
-- head=false, user=false, que é exatamente o portão de hoje. Sem essa linha,
-- ligar o recurso tiraria a aba dos admins de todos os tenants.
--
-- POR QUE O PORTÃO LÊ AS TABELAS E NÃO `get_my_permissions()`
-- Aquela função devolve TUDO liberado quando o tenant está com
-- `rbac_enabled = false`, que é a maioria. Usá-la aqui daria a aba de aprovação
-- a todo mundo desses tenants no dia em que o recurso nascesse. A resolução é
-- refeita aqui, na mesma ordem (usuário > tenant > global), sem o atalho do
-- rbac_enabled.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O recurso
-- ---------------------------------------------------------------------------
INSERT INTO public.resources
  (key, module, label, description, where_it_appears, parent_key, display_order, is_navigation, hidden)
SELECT
  'clientes.oem_aprovacao',
  'Cadastro do Cliente',
  'Aprovar pedidos do OEM',
  'Abre a aba Clientes > Aprovação OEM e libera aprovar ou recusar os pedidos da fila. Sem isso, só admin enxerga a aba.',
  'Clientes > Aprovação OEM',
  'clientes',
  COALESCE((SELECT r.display_order + 1 FROM public.resources r WHERE r.key = 'clientes.modulos'), 101),
  false,
  false
ON CONFLICT (key) DO UPDATE
  SET module           = EXCLUDED.module,
      label            = EXCLUDED.label,
      description      = EXCLUDED.description,
      where_it_appears = EXCLUDED.where_it_appears,
      parent_key       = EXCLUDED.parent_key;

-- ---------------------------------------------------------------------------
-- 2. Padrão por papel = o portão de hoje, escrito como dado.
-- ---------------------------------------------------------------------------
INSERT INTO public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
VALUES
  ('admin', 'clientes.oem_aprovacao', true,  true,  true,  true),
  ('head',  'clientes.oem_aprovacao', false, false, false, false),
  ('user',  'clientes.oem_aprovacao', false, false, false, false)
ON CONFLICT (role, resource_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. O portão, com a camada por usuário.
--
-- A armadilha do NULL continua sendo o ponto sensível desta função (ver o
-- comentário da 20260827130000): com o perfil ausente, comparar papel devolve
-- NULL, `NOT NULL` é NULL e o IF não dispara, liberando justamente para quem não
-- tem perfil. Por isso cada saída é explícita e o COALESCE fecha por fora.
-- Testável: rodando como `postgres` (sem auth.uid) tem que NEGAR.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_aprovacao_pode(p_tenant_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role   text;
  v_super  boolean;
  v_tenant uuid;
  v_pode   boolean;
BEGIN
  SELECT p.role, p.is_super_admin, p.tenant_id
    INTO v_role, v_super, v_tenant
    FROM public.profiles p
   WHERE p.user_id = auth.uid();

  IF COALESCE(v_super, false) THEN
    RETURN true;
  END IF;

  -- Sem perfil, sem tenant, ou olhando o tenant de outra empresa: nega.
  IF v_role IS NULL
     OR v_tenant IS NULL
     OR p_tenant_id IS NULL
     OR v_tenant <> p_tenant_id THEN
    RETURN false;
  END IF;

  -- Usuário > tenant > padrão global. `user_permissions` é única por
  -- (user_id, resource_key), então não há mais de uma linha para escolher.
  SELECT COALESCE(up.can_view, trp.can_view, rp.can_view, false)
    INTO v_pode
    FROM (SELECT 1) AS z
    LEFT JOIN public.role_permissions rp
      ON rp.resource_key = 'clientes.oem_aprovacao'
     AND rp.role = v_role
    LEFT JOIN public.tenant_role_permissions trp
      ON trp.resource_key = 'clientes.oem_aprovacao'
     AND trp.role = v_role
     AND trp.tenant_id = v_tenant
    LEFT JOIN public.user_permissions up
      ON up.resource_key = 'clientes.oem_aprovacao'
     AND up.user_id = auth.uid();

  RETURN COALESCE(v_pode, false);
END;
$$;

COMMENT ON FUNCTION public.fn_oem_aprovacao_pode(uuid) IS
  'Quem pode aprovar/recusar pedido do OEM: super admin, quem o recurso clientes.oem_aprovacao libera pelo papel (admin, por padrão), ou quem tem linha explícita em user_permissions. Sempre dentro do próprio tenant.';

REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_pode(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_aprovacao_pode(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_aprovacao_pode(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Conferência. Erro aqui é melhor do que portão errado em produção.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_papeis int;
  v_sem_auth boolean;
BEGIN
  SELECT count(*) INTO v_papeis
    FROM public.role_permissions
   WHERE resource_key = 'clientes.oem_aprovacao';
  IF v_papeis <> 3 THEN
    RAISE EXCEPTION 'Esperava o padrão dos 3 papéis, encontrei %', v_papeis;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.resources WHERE key = 'clientes.oem_aprovacao') THEN
    RAISE EXCEPTION 'Recurso clientes.oem_aprovacao não foi criado';
  END IF;

  -- Rodando como postgres não há auth.uid(): o portão tem que negar.
  SELECT public.fn_oem_aprovacao_pode('a0000000-0000-0000-0000-000000000001'::uuid)
    INTO v_sem_auth;
  IF COALESCE(v_sem_auth, true) THEN
    RAISE EXCEPTION 'Portão liberou para sessão sem perfil (devolveu %)', v_sem_auth;
  END IF;
END $$;

COMMIT;
