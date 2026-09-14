-- ============================================================================
-- Cascata pai → filho passa a descer a árvore INTEIRA
--
-- A cascata (decisão D7) zerava só os filhos DIRETOS. Enquanto o catálogo tinha
-- um nível só, dava no mesmo. Com a estrutura do menu a árvore ficou funda —
-- Clientes › Ficha › Financeiro › Custos e margens — e negar "Clientes"
-- deixava os netos liberados no banco. O teste T1 pegou: custos=true.
--
-- `union` (e não `union all`) na CTE recursiva: se algum dia alguém cadastrar
-- um ciclo em parent_key, a recursão para em vez de rodar para sempre.
-- ============================================================================
begin;

create or replace function public.rbac_set_group_permission(
  p_group_id uuid, p_resource_key text, p_action text, p_value boolean)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_base text; v_uid uuid := auth.uid(); v_old record; v_filhos int := 0;
begin
  select tenant_id, nivel_base into v_tenant, v_base
  from public.permission_groups where id = p_group_id;
  if v_tenant is null then raise exception 'Grupo inexistente'; end if;
  perform public.rbac_assert_admin(v_tenant);

  if p_action not in ('view','insert','update','delete') then
    raise exception 'Acao invalida: %', p_action;
  end if;

  -- Anti-lockout por celula: uniao das regras da tela e do banco.
  if v_base = 'admin' and p_value = false and (
       (p_resource_key = 'cfg.permissoes' and p_action in ('view','update'))
    or (p_resource_key = 'cfg.acessos'    and p_action = 'view')
    or (p_resource_key = 'usuarios_roles' and p_action = 'update')) then
    raise exception 'Anti-lockout: o grupo de administracao nao pode perder % em %', p_action, p_resource_key;
  end if;

  select * into v_old from public.group_permissions
   where group_id = p_group_id and resource_key = p_resource_key;

  insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
  values (p_group_id, p_resource_key,
    case when p_action='view'   then p_value else coalesce(v_old.can_view,false)   end,
    case when p_action='insert' then p_value else coalesce(v_old.can_insert,false) end,
    case when p_action='update' then p_value else coalesce(v_old.can_update,false) end,
    case when p_action='delete' then p_value else coalesce(v_old.can_delete,false) end, v_uid)
  on conflict (group_id, resource_key) do update set
    can_view=excluded.can_view, can_insert=excluded.can_insert,
    can_update=excluded.can_update, can_delete=excluded.can_delete,
    updated_at=now(), updated_by=v_uid;

  -- D7: negar o pai nega TODA a descendência, em qualquer profundidade.
  if p_action = 'view' and p_value = false then
    with recursive descendentes(key) as (
      select r.key from public.resources r where r.parent_key = p_resource_key
      union
      select r.key from public.resources r join descendentes d on r.parent_key = d.key
    )
    insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
    select p_group_id, d.key, false, false, false, false, v_uid from descendentes d
    on conflict (group_id, resource_key) do update set
      can_view=false, can_insert=false, can_update=false, can_delete=false,
      updated_at=now(), updated_by=v_uid;
    get diagnostics v_filhos = row_count;
  end if;

  perform public.rbac_assert_sem_lockout(v_tenant);

  insert into public.permission_audit (tenant_id, role, group_id, resource_key, action, old_value, new_value, changed_by)
  values (v_tenant, v_base, p_group_id, p_resource_key,
          case when p_value then 'granted' else 'revoked' end,
          to_jsonb(v_old), jsonb_build_object(p_action, p_value), v_uid);

  return jsonb_build_object('status','ok','descendentes_em_cascata',v_filhos);
end $$;

revoke all on function public.rbac_set_group_permission(uuid,text,text,boolean) from public;
grant execute on function public.rbac_set_group_permission(uuid,text,text,boolean) to authenticated, service_role;

commit;
