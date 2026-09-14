-- ============================================================================
-- RBAC v2 — has_perm / perm_scope: PRONTAS E DORMENTES
-- Nenhuma policy as usa. Existem para a F4/F5 serem "ligar", nao "escrever".
--
-- ⚠️ R10 — RECURSAO: has_perm() le `profiles`. As policies de `profiles`,
-- `resources`, `role_permissions`, `tenant_role_permissions`, `user_permissions`,
-- `permission_groups`, `group_permissions` e `user_groups` NUNCA podem chama-la.
--
-- ⚠️ R9 — toda policy que usar estas funcoes nasce `AS RESTRICTIVE`. Policy
-- PERMISSIVE soma com OU: ela AMPLIA o acesso, em silencio.
--
-- ⚠️ Chamar sempre como (SELECT has_perm(...)) para virar InitPlan e rodar
-- 1x por consulta, nao 1x por linha. 254 das 466 policies ja usam esse padrao.
--
-- ⚠️ PARALLEL SAFE nao e enfeite. Funcao SECURITY DEFINER nasce PARALLEL UNSAFE,
-- e uma policy que a chama DESLIGA o scan paralelo da tabela inteira. Medido em
-- whatsapp_messages (387 mil linhas): count(*) foi de 104ms para 1.027ms sem a
-- marcacao, e voltou para 110ms com ela. Dez vezes, em silencio.
-- ============================================================================
begin;

create or replace function public.has_perm(p_resource text, p_action text default 'view')
returns boolean language plpgsql stable parallel safe security definer set search_path='public','pg_catalog' as $$
declare
  v_role text; v_super boolean; v_tenant uuid; v_rbac boolean; v_v2 boolean;
  v_group uuid; v_res boolean;
begin
  select p.role, p.is_super_admin, p.tenant_id into v_role, v_super, v_tenant
  from public.profiles p where p.user_id = auth.uid() limit 1;

  if v_super then return true; end if;
  if v_role is null or v_tenant is null then return false; end if;

  select t.rbac_enabled, t.rbac_v2_enabled into v_rbac, v_v2
  from public.tenants t where t.id = v_tenant limit 1;
  if not coalesce(v_rbac,false) then return true; end if;   -- mesma regra do motor

  if coalesce(v_v2,false) then
    select ug.group_id into v_group from public.user_groups ug where ug.user_id = auth.uid() limit 1;
  end if;

  select coalesce(
    case p_action when 'view' then up.can_view when 'insert' then up.can_insert
                  when 'update' then up.can_update else up.can_delete end,
    case p_action when 'view' then gp.can_view when 'insert' then gp.can_insert
                  when 'update' then gp.can_update else gp.can_delete end,
    case p_action when 'view' then trp.can_view when 'insert' then trp.can_insert
                  when 'update' then trp.can_update else trp.can_delete end,
    case p_action when 'view' then rp.can_view when 'insert' then rp.can_insert
                  when 'update' then rp.can_update else rp.can_delete end,
    false) into v_res
  from (select 1) x
  left join public.user_permissions up
    on up.resource_key=p_resource and up.user_id=auth.uid() and up.tenant_id=v_tenant
  left join public.group_permissions gp on gp.resource_key=p_resource and gp.group_id=v_group
  left join public.tenant_role_permissions trp
    on trp.resource_key=p_resource and trp.role=v_role and trp.tenant_id=v_tenant
  left join public.role_permissions rp on rp.resource_key=p_resource and rp.role=v_role;

  return coalesce(v_res,false);
end $$;

create or replace function public.perm_scope(p_resource text, p_action text default 'view')
returns text language plpgsql stable parallel safe security definer set search_path='public','pg_catalog' as $$
declare v_super boolean; v_tenant uuid; v_v2 boolean; v_group uuid; v_escopo text;
begin
  select p.is_super_admin, p.tenant_id into v_super, v_tenant
  from public.profiles p where p.user_id = auth.uid() limit 1;
  if v_super then return 'todos'; end if;
  if v_tenant is null then return 'nenhum'; end if;

  select t.rbac_v2_enabled into v_v2 from public.tenants t where t.id=v_tenant limit 1;
  if not coalesce(v_v2,false) then return 'todos'; end if;   -- escopo so existe no v2

  select ug.group_id into v_group from public.user_groups ug where ug.user_id=auth.uid() limit 1;
  select gp.escopo into v_escopo from public.group_permissions gp
   where gp.group_id=v_group and gp.resource_key=p_resource;
  return coalesce(v_escopo,'todos');
end $$;

-- Setores do usuario. `support_department_members` tem user_id direto e a
-- coluna is_active — filtrar por ela nao e opcional.
create or replace function public.my_departments()
returns uuid[] language sql stable parallel safe security definer set search_path='public','pg_catalog' as $$
  select coalesce(array_agg(m.department_id), '{}'::uuid[])
  from public.support_department_members m
  where m.user_id = auth.uid() and coalesce(m.is_active,true);
$$;

revoke all on function public.has_perm(text,text) from public;
revoke all on function public.perm_scope(text,text) from public;
revoke all on function public.my_departments() from public;
grant execute on function public.has_perm(text,text) to authenticated, service_role;
grant execute on function public.perm_scope(text,text) to authenticated, service_role;
grant execute on function public.my_departments() to authenticated, service_role;

comment on function public.has_perm(text,text) is
  'RBAC v2. DORMENTE: nenhuma policy usa ainda (F4). Ao usar: (SELECT has_perm(...)) e AS RESTRICTIVE.';

commit;
