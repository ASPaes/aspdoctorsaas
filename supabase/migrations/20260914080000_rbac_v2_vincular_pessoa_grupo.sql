-- ============================================================================
-- RBAC v2 — vincular pessoa a grupo, mantendo `profiles.role` coerente
--
-- DEFEITO CORRIGIDO: a primeira versao de rbac_assign_user_group trocava o
-- grupo e NAO atualizava `profiles.role`. Como 27 funcoes do banco leem o papel
-- direto (is_admin_or_head, is_tenant_admin, pode_decidir_oem, reativar_cliente,
-- schedule_attendance...), mover alguem de grupo deixaria essas 27 enxergando o
-- papel antigo. E exatamente o que a decisao D8 existe para impedir.
-- ============================================================================
begin;

-- Mudar o tipo de retorno (void -> jsonb) exige DROP: o Postgres nao aceita
-- CREATE OR REPLACE nesse caso.
drop function if exists public.rbac_assign_user_group(uuid, uuid);

create or replace function public.rbac_assign_user_group(p_user_id uuid, p_group_id uuid)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare
  v_tenant uuid; v_tenant_user uuid; v_base text; v_role_antigo text; v_uid uuid := auth.uid();
begin
  select tenant_id, nivel_base into v_tenant, v_base
    from public.permission_groups where id = p_group_id;
  select tenant_id, role into v_tenant_user, v_role_antigo
    from public.profiles where user_id = p_user_id;

  if v_tenant is null then raise exception 'Grupo inexistente'; end if;
  if v_tenant_user is null then raise exception 'Pessoa inexistente'; end if;
  if v_tenant <> v_tenant_user then raise exception 'O grupo e de outra empresa'; end if;
  perform public.rbac_assert_admin(v_tenant);

  if p_user_id = v_uid then
    raise exception 'Voce nao pode trocar o proprio grupo. Peca a outro administrador.';
  end if;

  delete from public.user_groups where user_id = p_user_id;          -- D6: um grupo por pessoa
  insert into public.user_groups (user_id, group_id, tenant_id)
  values (p_user_id, p_group_id, v_tenant);

  -- D8: o papel legado acompanha o nivel base do grupo.
  update public.profiles set role = v_base where user_id = p_user_id;

  perform public.rbac_assert_sem_lockout(v_tenant);

  insert into public.permission_audit
    (tenant_id, role, group_id, resource_key, action, old_value, new_value, changed_by)
  values (v_tenant, v_base, p_group_id, '(grupo do usuario)', 'granted',
          jsonb_build_object('role', v_role_antigo),
          jsonb_build_object('user_id', p_user_id, 'group_id', p_group_id, 'role', v_base), v_uid);

  return jsonb_build_object('status','ok','role', v_base);
end $$;

revoke all on function public.rbac_assign_user_group(uuid,uuid) from public;
grant execute on function public.rbac_assign_user_group(uuid,uuid) to authenticated, service_role;

-- Quem esta em qual grupo, para a tela de Acessos.
create or replace function public.rbac_get_user_groups(p_tenant_id uuid default null)
returns table(user_id uuid, group_id uuid, group_nome text, nivel_base text)
language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid;
begin
  v_tenant := public.rbac_assert_admin(p_tenant_id);
  return query
  select ug.user_id, g.id, g.nome, g.nivel_base
  from public.user_groups ug
  join public.permission_groups g on g.id = ug.group_id
  where g.tenant_id = v_tenant;
end $$;

revoke all on function public.rbac_get_user_groups(uuid) from public;
grant execute on function public.rbac_get_user_groups(uuid) to authenticated, service_role;

commit;
