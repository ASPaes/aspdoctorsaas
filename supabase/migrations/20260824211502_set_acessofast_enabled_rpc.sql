create or replace function public.set_acessofast_enabled(p_tenant_id uuid, p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pode boolean;
begin
  if p_tenant_id is null then
    raise exception 'tenant não informado' using errcode = '22023';
  end if;

  -- Contratar é decisão de quem responde pela empresa. Sem esta checagem a
  -- policy de `tenants` (ALL para qualquer membro ativo) deixaria um operador
  -- ligar/desligar a integração.
  select public.is_super_admin()
      or exists (
        select 1 from public.profiles p
        where p.user_id = (select auth.uid())
          and p.tenant_id = p_tenant_id
          and p.role = 'admin'
          and p.access_status = 'active'
          and coalesce(p.status, 'ativo') = 'ativo'
      )
    into v_pode;

  if not coalesce(v_pode, false) then
    raise exception 'sem permissão para contratar o AcessoFast neste tenant'
      using errcode = '42501';
  end if;

  update public.tenants
     set acessofast_enabled = coalesce(p_enabled, false)
   where id = p_tenant_id;

  if not found then
    raise exception 'tenant % não encontrado', p_tenant_id using errcode = 'P0002';
  end if;

  return coalesce(p_enabled, false);
end;
$fn$;

revoke all on function public.set_acessofast_enabled(uuid, boolean) from public;
grant execute on function public.set_acessofast_enabled(uuid, boolean) to authenticated, service_role;
