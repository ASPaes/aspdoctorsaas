CREATE OR REPLACE FUNCTION public.get_tenant_access_users()
 RETURNS TABLE(user_id uuid, email text, role text, is_super_admin boolean, status text, funcionario_id bigint, funcionario_nome text, funcionario_email text, funcionario_ativo boolean, department_id uuid, department_name text, department_is_active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
declare
  v_tenant uuid;
  v_is_admin boolean;
begin
  select p.tenant_id into v_tenant
  from public.profiles p
  where p.user_id = auth.uid();

  if v_tenant is null then
    return;
  end if;

  select (p2.is_super_admin = true) or (p2.role in ('admin','head'))
  into v_is_admin
  from public.profiles p2
  where p2.user_id = auth.uid();

  if coalesce(v_is_admin,false) = false then
    raise exception 'not allowed';
  end if;

  return query
  select
    p.user_id                    as user_id,
    au.email::text               as email,
    p.role                       as role,
    p.is_super_admin             as is_super_admin,
    p.status                     as status,
    p.funcionario_id             as funcionario_id,
    f.nome::text                 as funcionario_nome,
    f.email::text                as funcionario_email,
    f.ativo                      as funcionario_ativo,
    f.department_id              as department_id,
    d.name::text                 as department_name,
    d.is_active                  as department_is_active
  from public.profiles p
  left join auth.users au on au.id = p.user_id
  left join public.funcionarios f on f.id = p.funcionario_id
  left join public.support_departments d on d.id = f.department_id
  where p.tenant_id = v_tenant
  order by coalesce(f.nome,'') asc;

end;
$function$;