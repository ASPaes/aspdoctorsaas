-- Allow non-admin authenticated users to INSERT conversations in their own tenant
CREATE POLICY "whatsapp_conversations_insert_by_member"
ON public.whatsapp_conversations
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.is_tenant_active_member()
);

-- Allow SELECT on conversations with NULL department_id for tenant members
-- (needed when useCreateConversation checks for existing conversations)
DROP POLICY IF EXISTS "whatsapp_conversations_select_by_department" ON public.whatsapp_conversations;
CREATE POLICY "whatsapp_conversations_select_by_department"
ON public.whatsapp_conversations
FOR SELECT
TO authenticated
USING (
  is_admin_or_head()
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      department_id = public.current_user_department_id()
      OR department_id IS NULL
    )
  )
);

-- Also allow UPDATE on NULL department conversations for dept users
DROP POLICY IF EXISTS "whatsapp_conversations_update_by_department" ON public.whatsapp_conversations;
CREATE POLICY "whatsapp_conversations_update_by_department"
ON public.whatsapp_conversations
FOR UPDATE
TO authenticated
USING (
  is_admin_or_head()
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      department_id = public.current_user_department_id()
      OR department_id IS NULL
    )
  )
)
WITH CHECK (
  is_admin_or_head()
  OR (
    tenant_id = public.current_tenant_id()
    AND (
      department_id = public.current_user_department_id()
      OR department_id IS NULL
    )
  )
);