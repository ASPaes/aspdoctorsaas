
CREATE FUNCTION public.get_tenant_users_with_email(p_tenant_id uuid)
 RETURNS TABLE(user_id uuid, email text, role text, status text, is_super_admin boolean, created_at timestamp with time zone, funcionario_id bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
  SELECT
    p.user_id,
    u.email::text,
    p.role,
    p.status,
    p.is_super_admin,
    p.created_at,
    p.funcionario_id
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.tenant_id = p_tenant_id
    AND (
      p_tenant_id = public.current_tenant_id()
      OR public.is_super_admin()
    )
  ORDER BY p.created_at
  LIMIT 50;
$function$;
