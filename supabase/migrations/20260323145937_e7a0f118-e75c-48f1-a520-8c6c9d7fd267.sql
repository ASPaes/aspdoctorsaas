
-- Fix 1: Add admin check to get_tenant_users_with_email RPC
CREATE OR REPLACE FUNCTION public.get_tenant_users_with_email(p_tenant_id uuid)
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
      (p_tenant_id = public.current_tenant_id() AND public.is_tenant_admin())
      OR public.is_super_admin()
    )
  ORDER BY p.created_at
  LIMIT 50;
$function$;

-- Fix 2: Add tenant_id check to department-scoped RLS policies

-- 2a: whatsapp_conversations update by department
DROP POLICY IF EXISTS "whatsapp_conversations_update_by_department" ON public.whatsapp_conversations;
CREATE POLICY "whatsapp_conversations_update_by_department" ON public.whatsapp_conversations
  FOR UPDATE TO authenticated
  USING (is_admin_or_head() OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id()))
  WITH CHECK (is_admin_or_head() OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id()));

-- 2b: support_attendances select by department
DROP POLICY IF EXISTS "support_attendances_select_by_department" ON public.support_attendances;
CREATE POLICY "support_attendances_select_by_department" ON public.support_attendances
  FOR SELECT TO authenticated
  USING (is_admin_or_head() OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id()));

-- 2c: support_attendances update by department
DROP POLICY IF EXISTS "support_attendances_update_by_department" ON public.support_attendances;
CREATE POLICY "support_attendances_update_by_department" ON public.support_attendances
  FOR UPDATE TO authenticated
  USING (is_admin_or_head() OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id()))
  WITH CHECK (is_admin_or_head() OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id()));
