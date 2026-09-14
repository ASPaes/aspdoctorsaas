-- ============================================================================
-- RBAC v2 — Parte 3 de 3: OPERAÇÕES DE ADMINISTRAÇÃO
-- Cada guarda aqui corresponde a um bug do pré-mortem (docs/rbac, seção 7-A).
-- ============================================================================
begin;

-- ------------------------------------------------------------- anti-lockout
-- B3: o anti-lockout de hoje e por celula. Com grupos surge um caminho novo —
-- ninguem mexe em permissao, so move ou desativa a ultima pessoa do grupo.
create or replace function public.rbac_pode_editar_permissoes(p_user_id uuid)
returns boolean language sql stable security definer set search_path='public','pg_catalog' as $$
  select coalesce((
    select coalesce(gp.can_update, trp.can_update, rp.can_update, false)
    from public.profiles p
    left join public.user_groups ug on ug.user_id = p.user_id
    left join public.group_permissions gp
      on gp.group_id = ug.group_id and gp.resource_key = 'cfg.permissoes'
    left join public.tenant_role_permissions trp
      on trp.tenant_id = p.tenant_id and trp.role = p.role and trp.resource_key = 'cfg.permissoes'
    left join public.role_permissions rp
      on rp.role = p.role and rp.resource_key = 'cfg.permissoes'
    where p.user_id = p_user_id
  ), false);
$$;

create or replace function public.rbac_assert_sem_lockout(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_n integer;
begin
  select count(*) into v_n
  from public.profiles p
  where p.tenant_id = p_tenant_id
    and coalesce(p.status,'ativo') = 'ativo'
    and (p.is_super_admin or public.rbac_pode_editar_permissoes(p.user_id));
  if v_n = 0 then
    raise exception 'Bloqueado: a empresa ficaria sem ninguem capaz de editar permissoes (anti-lockout).';
  end if;
end $$;

-- ------------------------------------------------------------ quem pode mexer
create or replace function public.rbac_assert_admin(p_tenant_id uuid)
returns uuid language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_uid uuid := auth.uid(); v_own uuid;
begin
  if v_uid is null then raise exception 'Nao autenticado'; end if;
  select tenant_id into v_own from public.profiles where user_id = v_uid limit 1;
  if public.is_super_admin() then return coalesce(p_tenant_id, v_own); end if;
  if not public.is_tenant_admin() then raise exception 'Apenas admin pode editar permissoes'; end if;
  if p_tenant_id is not null and p_tenant_id <> v_own then
    raise exception 'Sem permissao para gerenciar outra empresa';
  end if;
  return v_own;
end $$;

-- --------------------------------------------------- gravar uma permissao
-- D7 (cascata pai->filho) + anti-lockout unificado tela/banco.
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

  -- Anti-lockout por celula: uniao das regras que hoje vivem separadas na
  -- tela (cfg.permissoes, cfg.acessos) e no banco (usuarios_roles).
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

  -- D7: cascata so no sentido restritivo. Negar o pai nega os filhos.
  if p_action = 'view' and p_value = false then
    with filhos as (select key from public.resources where parent_key = p_resource_key)
    insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
    select p_group_id, f.key, false, false, false, false, v_uid from filhos f
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

  return jsonb_build_object('status','ok','filhos_em_cascata',v_filhos);
end $$;

-- --------------------------------------------------- nivel de controle (D10)
-- B1: descer de nivel NUNCA pode aumentar acesso. Materializa com o valor
-- MAIS RESTRITIVO entre pai e filho — nao com o valor do pai.
create or replace function public.rbac_set_module_level(
  p_tenant_id uuid, p_module_id text, p_nivel smallint)
returns jsonb language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_uid uuid := auth.uid(); v_atual smallint; v_mat int := 0;
begin
  v_tenant := public.rbac_assert_admin(p_tenant_id);
  if p_nivel not between 1 and 3 then raise exception 'Nivel invalido: %', p_nivel; end if;

  select nivel into v_atual from public.tenant_module_levels
   where tenant_id = v_tenant and module_id = p_module_id;

  if v_atual is not null and p_nivel < v_atual then
    -- Grava por escrito o destino de cada recurso que sai da tela.
    with saindo as (
      select r.key, r.parent_key
      from public.resources r
      where r.module_id = p_module_id and r.nivel > p_nivel
    ), alvo as (
      select g.id as group_id, s.key,
             -- mais restritivo entre o filho e o pai
             coalesce(gpf.can_view,false) and coalesce(gpp.can_view, coalesce(gpf.can_view,false)) as v
      from public.permission_groups g
      join saindo s on true
      left join public.group_permissions gpf on gpf.group_id=g.id and gpf.resource_key=s.key
      left join public.group_permissions gpp on gpp.group_id=g.id and gpp.resource_key=s.parent_key
      where g.tenant_id = v_tenant
    )
    insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete, updated_by)
    select a.group_id, a.key, a.v, false, false, false, v_uid from alvo a
    on conflict (group_id, resource_key) do update set
      can_view = excluded.can_view, updated_at = now(), updated_by = v_uid;
    get diagnostics v_mat = row_count;
  end if;

  insert into public.tenant_module_levels (tenant_id, module_id, nivel, updated_by)
  values (v_tenant, p_module_id, p_nivel, v_uid)
  on conflict (tenant_id, module_id) do update set nivel=excluded.nivel, updated_at=now(), updated_by=v_uid;

  perform public.rbac_assert_sem_lockout(v_tenant);
  return jsonb_build_object('status','ok','materializados',v_mat);
end $$;

-- ------------------------------------------------------- grupos: CRUD seguro
-- B2: grupo nasce so por DUPLICACAO. Um grupo vazio nao teria de onde herdar.
create or replace function public.rbac_duplicate_group(p_source_group_id uuid, p_nome text)
returns uuid language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_base text; v_novo uuid; v_slug text; v_uid uuid := auth.uid();
begin
  select tenant_id, nivel_base into v_tenant, v_base
  from public.permission_groups where id = p_source_group_id;
  if v_tenant is null then raise exception 'Grupo de origem inexistente'; end if;
  perform public.rbac_assert_admin(v_tenant);
  if coalesce(trim(p_nome),'') = '' then raise exception 'Informe o nome do grupo'; end if;

  v_slug := regexp_replace(lower(trim(p_nome)), '[^a-z0-9]+', '-', 'g');
  if exists (select 1 from public.permission_groups where tenant_id=v_tenant and slug=v_slug) then
    v_slug := v_slug || '-' || substr(md5(random()::text),1,4);
  end if;

  insert into public.permission_groups (tenant_id, nome, slug, nivel_base, is_system, ordem, created_by)
  values (v_tenant, trim(p_nome), v_slug, v_base, false,
          coalesce((select max(ordem)+10 from public.permission_groups where tenant_id=v_tenant),100), v_uid)
  returning id into v_novo;

  insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete, escopo, updated_by)
  select v_novo, gp.resource_key, gp.can_view, gp.can_insert, gp.can_update, gp.can_delete, gp.escopo, v_uid
  from public.group_permissions gp where gp.group_id = p_source_group_id;

  return v_novo;
end $$;

create or replace function public.rbac_rename_group(p_group_id uuid, p_nome text)
returns void language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.permission_groups where id=p_group_id;
  if v_tenant is null then raise exception 'Grupo inexistente'; end if;
  perform public.rbac_assert_admin(v_tenant);
  if coalesce(trim(p_nome),'') = '' then raise exception 'Informe o nome do grupo'; end if;
  update public.permission_groups set nome = trim(p_nome) where id = p_group_id;
end $$;

create or replace function public.rbac_delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_sys boolean; v_membros int;
begin
  select tenant_id, is_system into v_tenant, v_sys from public.permission_groups where id=p_group_id;
  if v_tenant is null then raise exception 'Grupo inexistente'; end if;
  perform public.rbac_assert_admin(v_tenant);
  if v_sys then raise exception 'Os grupos base nao podem ser excluidos. Renomeie ou ajuste as permissoes.'; end if;
  select count(*) into v_membros from public.user_groups where group_id=p_group_id;
  if v_membros > 0 then
    raise exception 'Este grupo tem % pessoa(s). Mova-as para outro grupo antes de excluir.', v_membros;
  end if;
  delete from public.permission_groups where id = p_group_id;
  perform public.rbac_assert_sem_lockout(v_tenant);
end $$;

-- B3/B7: mover pessoa de grupo passa pelo anti-lockout.
create or replace function public.rbac_assign_user_group(p_user_id uuid, p_group_id uuid)
returns void language plpgsql security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid; v_tenant_user uuid;
begin
  select tenant_id into v_tenant from public.permission_groups where id=p_group_id;
  select tenant_id into v_tenant_user from public.profiles where user_id=p_user_id;
  if v_tenant is null or v_tenant_user is null then raise exception 'Grupo ou pessoa inexistente'; end if;
  if v_tenant <> v_tenant_user then raise exception 'O grupo e de outra empresa'; end if;
  perform public.rbac_assert_admin(v_tenant);

  delete from public.user_groups where user_id = p_user_id;           -- D6: um grupo por pessoa
  insert into public.user_groups (user_id, group_id, tenant_id) values (p_user_id, p_group_id, v_tenant);

  perform public.rbac_assert_sem_lockout(v_tenant);
end $$;

-- ------------------------------------------------------- leitura para a tela
create or replace function public.rbac_get_config(p_tenant_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='public','pg_catalog' as $$
declare v_tenant uuid;
begin
  v_tenant := public.rbac_assert_admin(p_tenant_id);
  return jsonb_build_object(
    'tenant_id', v_tenant,
    'v2_ligado', (select rbac_v2_enabled from public.tenants where id=v_tenant),
    'modulos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id',m.id,'nome',m.nome,'descricao',m.descricao,'ordem',m.ordem,
                  'nivel', coalesce(l.nivel,1)) order by m.ordem),'[]'::jsonb)
                from public.permission_modules m
                left join public.tenant_module_levels l on l.module_id=m.id and l.tenant_id=v_tenant),
    'grupos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id',g.id,'nome',g.nome,'slug',g.slug,'nivel_base',g.nivel_base,
                  'is_system',g.is_system,'ordem',g.ordem,
                  'membros',(select count(*) from public.user_groups ug where ug.group_id=g.id)
                ) order by g.ordem),'[]'::jsonb)
               from public.permission_groups g where g.tenant_id=v_tenant),
    'recursos', (select coalesce(jsonb_agg(jsonb_build_object(
                  'key',r.key,'label',r.label,'descricao',r.description,'module_id',r.module_id,
                  'parent_key',r.parent_key,'nivel',r.nivel,'ordem',r.display_order
                ) order by r.display_order),'[]'::jsonb)
                from public.resources r where not r.hidden),
    'permissoes', (select coalesce(jsonb_agg(jsonb_build_object(
                  'group_id',gp.group_id,'key',gp.resource_key,'view',gp.can_view,
                  'insert',gp.can_insert,'update',gp.can_update,'delete',gp.can_delete,'escopo',gp.escopo)),'[]'::jsonb)
                from public.group_permissions gp
                join public.permission_groups g on g.id=gp.group_id where g.tenant_id=v_tenant)
  );
end $$;

-- ----------------------------------------------------------------- grants
revoke all on function public.rbac_set_group_permission(uuid,text,text,boolean) from public;
revoke all on function public.rbac_set_module_level(uuid,text,smallint) from public;
revoke all on function public.rbac_duplicate_group(uuid,text) from public;
revoke all on function public.rbac_rename_group(uuid,text) from public;
revoke all on function public.rbac_delete_group(uuid) from public;
revoke all on function public.rbac_assign_user_group(uuid,uuid) from public;
revoke all on function public.rbac_get_config(uuid) from public;
revoke all on function public.rbac_assert_admin(uuid) from public;
revoke all on function public.rbac_assert_sem_lockout(uuid) from public;
revoke all on function public.rbac_pode_editar_permissoes(uuid) from public;

grant execute on function public.rbac_set_group_permission(uuid,text,text,boolean) to authenticated, service_role;
grant execute on function public.rbac_set_module_level(uuid,text,smallint) to authenticated, service_role;
grant execute on function public.rbac_duplicate_group(uuid,text) to authenticated, service_role;
grant execute on function public.rbac_rename_group(uuid,text) to authenticated, service_role;
grant execute on function public.rbac_delete_group(uuid) to authenticated, service_role;
grant execute on function public.rbac_assign_user_group(uuid,uuid) to authenticated, service_role;
grant execute on function public.rbac_get_config(uuid) to authenticated, service_role;

-- ------------------------------------------------------------------- RLS
alter table public.permission_groups   enable row level security;
alter table public.group_permissions   enable row level security;
alter table public.user_groups         enable row level security;
alter table public.tenant_module_levels enable row level security;
alter table public.permission_modules  enable row level security;

-- R10: estas tabelas NUNCA podem usar has_perm() nas proprias policies —
-- has_perm le profiles e entraria em recursao infinita.
drop policy if exists pg_select on public.permission_groups;
create policy pg_select on public.permission_groups for select
  using ((select public.is_super_admin()) or tenant_id = (select public.current_tenant_id()));

drop policy if exists gp_select on public.group_permissions;
create policy gp_select on public.group_permissions for select
  using ((select public.is_super_admin()) or exists (
    select 1 from public.permission_groups g
    where g.id = group_permissions.group_id and g.tenant_id = (select public.current_tenant_id())));

drop policy if exists ug_select on public.user_groups;
create policy ug_select on public.user_groups for select
  using ((select public.is_super_admin()) or tenant_id = (select public.current_tenant_id()));

drop policy if exists tml_select on public.tenant_module_levels;
create policy tml_select on public.tenant_module_levels for select
  using ((select public.is_super_admin()) or tenant_id = (select public.current_tenant_id()));

drop policy if exists pm_select on public.permission_modules;
create policy pm_select on public.permission_modules for select using (true);

grant select on public.permission_groups, public.group_permissions, public.user_groups,
                public.tenant_module_levels, public.permission_modules to authenticated, service_role;

commit;
