-- Empresa nova nasce igual às existentes depois da 20261002120000 (decisão do
-- Alexandre, 02/10/2026): Administrador com tudo liberado nos itens visíveis e
-- todo módulo no nível 3. Gestor e Operador seguem herdando o padrão do papel.
-- Base: a versão de produção desta função (md5 143887d40447d9d9f071960d7667b019).
-- Só o gatilho trg_tenants_rbac_provisionar a chama; tudo segue "do nothing" em
-- conflito, então rodar de novo numa empresa existente não desfaz edição de admin.

create or replace function public.rbac_provisionar_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  insert into public.permission_groups (tenant_id, nome, slug, nivel_base, is_system, ordem)
  select p_tenant_id, g.nome, g.slug, g.base, true, g.ordem
  from (values
    ('Administrador','administrador','admin',10),
    ('Gestor',       'gestor',       'head', 20),
    ('Operador',     'operador',     'user', 30)
  ) as g(nome, slug, base, ordem)
  on conflict (tenant_id, slug) do nothing;

  insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
  select g.id, r.key,
         tudo or coalesce(trp.can_view,   rp.can_view,   false),
         tudo or coalesce(trp.can_insert, rp.can_insert, false),
         tudo or coalesce(trp.can_update, rp.can_update, false),
         tudo or coalesce(trp.can_delete, rp.can_delete, false)
  from public.permission_groups g
  cross join public.resources r
  cross join lateral (select g.nivel_base = 'admin' and not r.hidden as tudo) x
  left join public.tenant_role_permissions trp
    on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = r.key
  left join public.role_permissions rp
    on rp.role = g.nivel_base and rp.resource_key = r.key
  where g.tenant_id = p_tenant_id and g.is_system
  on conflict (group_id, resource_key) do nothing;

  insert into public.tenant_module_levels (tenant_id, module_id, nivel)
  select p_tenant_id, m.id, 3
  from public.permission_modules m
  on conflict (tenant_id, module_id) do nothing;

  insert into public.user_groups (user_id, group_id, tenant_id)
  select p.user_id, g.id, p.tenant_id
  from public.profiles p
  join public.permission_groups g
    on g.tenant_id = p.tenant_id and g.nivel_base = p.role and g.is_system
  where p.tenant_id = p_tenant_id and p.user_id is not null
  on conflict (user_id) do nothing;

  update public.tenants set rbac_v2_enabled = true
   where id = p_tenant_id and rbac_v2_enabled is distinct from true;
end $function$;
