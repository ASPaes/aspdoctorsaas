-- ============================================================================
-- RBAC — empresa nova já nasce no motor de grupos.
--
-- Achado em 28/09/2026: a Conta Hábil (criada 21/09) ficou com
-- rbac_v2_enabled=false, 0 grupos e as 5 pessoas sem grupo. A semeadura de
-- 14/09 rodou UMA vez sobre as empresas que existiam; nada cobria empresa
-- criada depois. O mesmo buraco vale para PESSOA nova: ninguém entra em
-- `user_groups` sozinho (a tela antiga de Acessos grava só `profiles.role`).
--
-- Três peças:
--   1. rbac_provisionar_tenant(tenant) — idempotente. Cria os 3 grupos-base,
--      semeia cada grupo com o valor de HOJE daquela empresa/papel
--      (coalesce(trp, rp, false), a mesma régua das semeaduras de 18/09 e
--      20/09 — medido em 28/09: nas 14 empresas o grupo bate com essa régua,
--      fora edições manuais), vincula as pessoas pelo papel e liga a flag.
--      Resultado: 0 mudança de acesso para quem já estava no motor antigo.
--   2. Gatilho em tenants: empresa nova chama (1) na criação.
--   3. Gatilho em profiles: pessoa nova ou troca de papel → grupo-base do
--      papel, SE o grupo atual não for do mesmo nível. Quem está num grupo
--      personalizado do mesmo nível fica onde está. `rbac_assign_user_group`
--      grava o grupo antes do papel, então o gatilho vê tudo alinhado e não age.
-- ============================================================================

create or replace function public.rbac_provisionar_tenant(p_tenant_id uuid)
 returns void
 language plpgsql security definer
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
         coalesce(trp.can_view,   rp.can_view,   false),
         coalesce(trp.can_insert, rp.can_insert, false),
         coalesce(trp.can_update, rp.can_update, false),
         coalesce(trp.can_delete, rp.can_delete, false)
  from public.permission_groups g
  cross join public.resources r
  left join public.tenant_role_permissions trp
    on trp.tenant_id = g.tenant_id and trp.role = g.nivel_base and trp.resource_key = r.key
  left join public.role_permissions rp
    on rp.role = g.nivel_base and rp.resource_key = r.key
  where g.tenant_id = p_tenant_id and g.is_system
  on conflict (group_id, resource_key) do nothing;

  -- Papel fora dos três (ex.: `viewer`) fica sem grupo, como na semeadura de 14/09.
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

revoke all on function public.rbac_provisionar_tenant(uuid) from public, anon, authenticated;
grant execute on function public.rbac_provisionar_tenant(uuid) to service_role;

-- ------------------------------------------------------- empresa nova
create or replace function public.trg_rbac_provisionar_tenant()
 returns trigger
 language plpgsql security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  perform public.rbac_provisionar_tenant(new.id);
  return new;
end $function$;

revoke all on function public.trg_rbac_provisionar_tenant() from public, anon, authenticated;

drop trigger if exists trg_tenants_rbac_provisionar on public.tenants;
create trigger trg_tenants_rbac_provisionar
  after insert on public.tenants
  for each row execute function public.trg_rbac_provisionar_tenant();

-- ------------------------------------------ pessoa nova / troca de papel
create or replace function public.trg_rbac_sync_user_group()
 returns trigger
 language plpgsql security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare v_atual uuid; v_alvo uuid;
begin
  if new.user_id is null or new.tenant_id is null then return new; end if;

  select ug.group_id into v_atual
    from public.user_groups ug
    join public.permission_groups g on g.id = ug.group_id
   where ug.user_id = new.user_id
     and g.tenant_id = new.tenant_id
     and g.nivel_base = new.role;
  if v_atual is not null then return new; end if;   -- já está num grupo do nível certo

  select g.id into v_alvo
    from public.permission_groups g
   where g.tenant_id = new.tenant_id and g.nivel_base = new.role and g.is_system;
  if v_alvo is null then return new; end if;        -- empresa sem grupos ou papel fora dos 3

  delete from public.user_groups where user_id = new.user_id;
  insert into public.user_groups (user_id, group_id, tenant_id)
  values (new.user_id, v_alvo, new.tenant_id);
  return new;
end $function$;

revoke all on function public.trg_rbac_sync_user_group() from public, anon, authenticated;

drop trigger if exists trg_profiles_rbac_sync_group on public.profiles;
create trigger trg_profiles_rbac_sync_group
  after insert or update of role, tenant_id, user_id on public.profiles
  for each row execute function public.trg_rbac_sync_user_group();

alter table public.tenants alter column rbac_v2_enabled set default true;

-- ------------------------------------------ empresas que já nasceram sem
select public.rbac_provisionar_tenant(t.id)
from public.tenants t
where not exists (select 1 from public.permission_groups g where g.tenant_id = t.id);
