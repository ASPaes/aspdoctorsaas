-- ============================================================================
-- RBAC v2 — Parte 2 de 3: SEMEADURA + MOTOR
-- ============================================================================
begin;

-- ---------------------------------------------------------- grupos-semente
-- D9: os 3 papeis de hoje viram grupos editaveis. Nome e permissoes podem ser
-- alterados; nivel_base e imutavel; is_system impede exclusao.
insert into public.permission_groups (tenant_id, nome, slug, nivel_base, is_system, ordem)
select t.id, g.nome, g.slug, g.base, true, g.ordem
from public.tenants t
cross join (values
  ('Administrador','administrador','admin',10),
  ('Gestor',       'gestor',       'head', 20),
  ('Operador',     'operador',     'user', 30)
) as g(nome, slug, base, ordem)
on conflict (tenant_id, slug) do nothing;

-- ----------------------------------------- semeadura ESPARSA (condicao C4)
-- Copia APENAS as regras que o tenant ja tem. Materializar o valor resolvido
-- congelaria o padrao global para aquele tenant e mudaria o comportamento
-- futuro sem ninguem perceber.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select pg.id, trp.resource_key, trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
from public.tenant_role_permissions trp
join public.permission_groups pg
  on pg.tenant_id = trp.tenant_id and pg.nivel_base = trp.role and pg.is_system
on conflict (group_id, resource_key) do nothing;

-- ------------------------------------------------- vinculo pessoa -> grupo
-- Quem tem papel fora dos tres (o `viewer` do ASP) fica SEM grupo de
-- proposito: hoje ele recebe false em tudo, e a noite 1 nao muda ninguem.
insert into public.user_groups (user_id, group_id, tenant_id)
select p.user_id, pg.id, p.tenant_id
from public.profiles p
join public.permission_groups pg
  on pg.tenant_id = p.tenant_id and pg.nivel_base = p.role and pg.is_system
where p.user_id is not null
on conflict (user_id) do nothing;

-- ----------------------------------------------------------- motor (C2)
-- O desvio pela flag mora DENTRO da funcao. Ela e unica e global: sem isso,
-- publicar o frontend nao protegeria os tenants que continuam no motor antigo.
create or replace function public.get_my_permissions()
 returns table(resource_key text, module text, label text, description text,
               where_it_appears text, is_navigation boolean, hidden boolean,
               parent_key text, display_order integer, can_view boolean,
               can_insert boolean, can_update boolean, can_delete boolean)
 language plpgsql stable security definer set search_path to 'public','pg_catalog'
as $function$
declare
  v_role text; v_is_super boolean; v_tenant_id uuid;
  v_rbac boolean; v_v2 boolean; v_group uuid;
begin
  select p.role, p.is_super_admin, p.tenant_id
    into v_role, v_is_super, v_tenant_id
  from public.profiles p where p.user_id = auth.uid() limit 1;

  if v_is_super then
    return query select r.key,r.module,r.label,r.description,r.where_it_appears,
                        r.is_navigation,r.hidden,r.parent_key,r.display_order,
                        true,true,true,true
                 from public.resources r order by r.display_order;
    return;
  end if;

  if v_role is null or v_tenant_id is null then return; end if;

  select t.rbac_enabled, t.rbac_v2_enabled into v_rbac, v_v2
  from public.tenants t where t.id = v_tenant_id limit 1;

  if not coalesce(v_rbac,false) then
    return query select r.key,r.module,r.label,r.description,r.where_it_appears,
                        r.is_navigation,r.hidden,r.parent_key,r.display_order,
                        true,true,true,true
                 from public.resources r order by r.display_order;
    return;
  end if;

  -- ---------- motor NOVO: so para quem tem a flag ligada ----------
  if coalesce(v_v2,false) then
    select ug.group_id into v_group
    from public.user_groups ug where ug.user_id = auth.uid() limit 1;

    return query
    select r.key,r.module,r.label,r.description,r.where_it_appears,
           r.is_navigation,r.hidden,r.parent_key,r.display_order,
           coalesce(up.can_view,   gp.can_view,   trp.can_view,   rp.can_view,   false),
           coalesce(up.can_insert, gp.can_insert, trp.can_insert, rp.can_insert, false),
           coalesce(up.can_update, gp.can_update, trp.can_update, rp.can_update, false),
           coalesce(up.can_delete, gp.can_delete, trp.can_delete, rp.can_delete, false)
    from public.resources r
    left join public.group_permissions gp
      on gp.resource_key = r.key and gp.group_id = v_group
    left join public.tenant_role_permissions trp
      on trp.resource_key = r.key and trp.role = v_role and trp.tenant_id = v_tenant_id
    left join public.role_permissions rp
      on rp.resource_key = r.key and rp.role = v_role
    -- P7: a juncao por pessoa passa a filtrar o tenant. A coluna existia e nao era usada.
    left join public.user_permissions up
      on up.resource_key = r.key and up.user_id = auth.uid() and up.tenant_id = v_tenant_id
    order by r.display_order;
    return;
  end if;

  -- ---------- motor LEGADO: intocado, para os demais tenants ----------
  return query
  select r.key,r.module,r.label,r.description,r.where_it_appears,
         r.is_navigation,r.hidden,r.parent_key,r.display_order,
         coalesce(up.can_view,   trp.can_view,   rp.can_view,   false),
         coalesce(up.can_insert, trp.can_insert, rp.can_insert, false),
         coalesce(up.can_update, trp.can_update, rp.can_update, false),
         coalesce(up.can_delete, trp.can_delete, rp.can_delete, false)
  from public.resources r
  left join public.role_permissions rp on rp.resource_key=r.key and rp.role=v_role
  left join public.tenant_role_permissions trp
    on trp.resource_key=r.key and trp.role=v_role and trp.tenant_id=v_tenant_id
  left join public.user_permissions up on up.resource_key=r.key and up.user_id=auth.uid()
  order by r.display_order;
end; $function$;

revoke all on function public.get_my_permissions() from public;
grant execute on function public.get_my_permissions() to authenticated, service_role;

commit;
