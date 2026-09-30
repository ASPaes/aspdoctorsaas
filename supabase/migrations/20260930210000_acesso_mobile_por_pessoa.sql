-- ============================================================================
-- Acesso ao mobile.doctorsaas.com.br por pessoa (coluna "Mobile" em
-- Configurações › Equipe › Acessos & Permissões).
--
-- Decisão de 30/09/2026: admin nasce com Sim; head e user com Não; super admin
-- passa sempre. Quem está com Não faz login e vê o aviso de falar com o gestor.
--
--   1. Chave `acesso.mobile`, HIDDEN: não aparece na matriz de Perfis (o
--      `rbac_get_config` filtra `not hidden`), só na coluna própria. Assim
--      nunca nasce linha em `group_permissions` e a tela resolve o valor igual
--      ao banco: pessoa › papel no tenant › papel global.
--   2. Padrão global por papel.
--   3. `pode_usar_mobile()`, o portão que o mobile consulta. NÃO usa
--      `get_my_permissions`: em tenant com `rbac_enabled = false` ela devolve
--      tudo liberado, e o Não seria ignorado em 4 tenants (medido 30/09).
-- ============================================================================

-- ----------------------------------------------------------------- 1) chave
INSERT INTO public.resources
  (key, module, label, description, parent_key, display_order, hidden,
   is_navigation, where_it_appears, module_id, nivel, acoes, secao, grupo, grupo_ordem)
SELECT 'acesso.mobile', r.module, 'Acesso ao mobile',
       'Entrar no DoctorSaaS pelo telefone (mobile.doctorsaas.com.br). Sem isso a pessoa faz login e vê o aviso de falar com o gestor. Não mexe no acesso pelo computador.',
       'cfg.acessos', r.display_order + 10, true,
       false, 'mobile.doctorsaas.com.br',
       r.module_id, r.nivel, '{view}'::text[], r.secao, r.grupo, r.grupo_ordem
  FROM public.resources r
 WHERE r.key = 'usuarios.desativar'
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------ 2) padrão
INSERT INTO public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
SELECT p.role, 'acesso.mobile', p.role = 'admin', false, false, false
  FROM (VALUES ('admin'), ('head'), ('user')) AS p(role)
ON CONFLICT (role, resource_key) DO NOTHING;

-- ------------------------------------------------------------ 3) portão
CREATE OR REPLACE FUNCTION public.pode_usar_mobile()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case
    when p.user_id is null then false
    when coalesce(p.is_super_admin, false) then true
    else coalesce(
      (select up.can_view from public.user_permissions up
        where up.user_id = p.user_id and up.tenant_id = p.tenant_id
          and up.resource_key = 'acesso.mobile'),
      (select trp.can_view from public.tenant_role_permissions trp
        where trp.tenant_id = p.tenant_id and trp.role = p.role
          and trp.resource_key = 'acesso.mobile'),
      (select rp.can_view from public.role_permissions rp
        where rp.role = p.role and rp.resource_key = 'acesso.mobile'),
      false)
  end
  from (select auth.uid() as uid) me
  left join public.profiles p on p.user_id = me.uid;
$function$;

REVOKE ALL ON FUNCTION public.pode_usar_mobile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_usar_mobile() TO authenticated, service_role;
