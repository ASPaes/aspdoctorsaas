
DROP FUNCTION IF EXISTS public.get_tenant_access_users();

CREATE FUNCTION public.get_tenant_access_users()
RETURNS TABLE(
  user_id uuid,
  email text,
  role text,
  is_super_admin boolean,
  tenant_id uuid,
  funcionario_id bigint,
  funcionario_nome text,
  funcionario_email text,
  funcionario_ativo boolean,
  department_id uuid,
  department_name text,
  department_is_active boolean,
  access_status text,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_tenant_id uuid;
begin
  select p.tenant_id
    into v_tenant_id
  from public.profiles p
  where p.user_id = auth.uid();

  if v_tenant_id is null then
    return;
  end if;

  return query
  select
    p.user_id,
    coalesce(au.email, f.email)::text as email,
    p.role,
    p.is_super_admin,
    p.tenant_id,
    f.id as funcionario_id,
    f.nome as funcionario_nome,
    f.email as funcionario_email,
    f.ativo as funcionario_ativo,
    f.department_id,
    d.name as department_name,
    d.is_active as department_is_active,
    p.access_status,
    p.status
  from public.profiles p
  left join auth.users au
    on au.id = p.user_id
  left join public.funcionarios f
    on f.id = p.funcionario_id
  left join public.support_departments d
    on d.id = f.department_id
  where p.tenant_id = v_tenant_id
  order by coalesce(f.nome, ''), p.user_id;
end;
$$;
