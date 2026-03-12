
CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = 'pg_catalog', 'public'
AS $function$
  select coalesce(p.is_super_admin, false)
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$function$;

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path = 'pg_catalog', 'public'
AS $function$
  select p.tenant_id
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$function$;
