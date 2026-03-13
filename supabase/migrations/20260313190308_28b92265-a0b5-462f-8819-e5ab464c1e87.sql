CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT p.tenant_id
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$function$;