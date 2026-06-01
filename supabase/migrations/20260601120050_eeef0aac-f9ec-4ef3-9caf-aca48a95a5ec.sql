CREATE OR REPLACE FUNCTION public.get_transfer_agents()
 RETURNS TABLE(user_id uuid, nome text, role text, status text, department_id uuid, department_name text, is_super_admin boolean, presence_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    p.user_id,
    COALESCE(f.nome, p.user_id::text) AS nome,
    p.role,
    COALESCE(p.status, p.access_status, 'ativo')::text AS status,
    f.department_id,
    d.name AS department_name,
    COALESCE(p.is_super_admin, false) AS is_super_admin,
    CASE
      WHEN sap.status IN ('active', 'online') THEN 'online'
      WHEN sap.status = 'paused' THEN 'paused'
      ELSE 'offline'
    END::text AS presence_status
  FROM public.profiles p
  LEFT JOIN public.funcionarios f
    ON f.id = p.funcionario_id
   AND f.tenant_id = p.tenant_id
  LEFT JOIN public.support_departments d
    ON d.id = f.department_id
   AND d.tenant_id = p.tenant_id
  LEFT JOIN public.support_agent_presence sap
    ON sap.user_id = p.user_id
   AND sap.tenant_id = p.tenant_id
  WHERE p.tenant_id = public.current_tenant_id()
    AND COALESCE(p.access_status, 'active') = 'active'
  ORDER BY
    CASE
      WHEN sap.status IN ('active', 'online') THEN 1
      WHEN sap.status = 'paused' THEN 2
      ELSE 3
    END,
    COALESCE(f.nome, p.user_id::text);
END;
$function$;