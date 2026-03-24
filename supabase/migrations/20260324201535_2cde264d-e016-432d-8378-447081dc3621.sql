DROP FUNCTION IF EXISTS public.get_tenant_access_users();

CREATE OR REPLACE FUNCTION public.get_tenant_access_users()
 RETURNS TABLE(
   user_id uuid,
   email text,
   role text,
   is_super_admin boolean,
   tenant_id uuid,
   status text,
   funcionario_id bigint,
   funcionario_nome text,
   funcionario_email text,
   funcionario_ativo boolean,
   department_id uuid,
   department_name text,
   department_is_active boolean
 )
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $$
  select
    p.user_id,
    u.email::text,
    p.role,
    p.is_super_admin,
    p.tenant_id,
    p.status,
    p.funcionario_id,
    f.nome as funcionario_nome,
    f.email as funcionario_email,
    f.ativo as funcionario_ativo,
    f.department_id,
    d.name as department_name,
    d.is_active as department_is_active
  from public.profiles p
  join auth.users u on u.id = p.user_id
  left join public.funcionarios f
    on f.id = p.funcionario_id
   and f.tenant_id = p.tenant_id
  left join public.support_departments d
    on d.id = f.department_id
   and d.tenant_id = p.tenant_id
  where p.tenant_id = (
    select p2.tenant_id
    from public.profiles p2
    where p2.user_id = auth.uid()
    limit 1
  )
  order by coalesce(f.nome, '') asc;
$$;