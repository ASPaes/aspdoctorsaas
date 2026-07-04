
-- 1) Prevent self-privilege escalation on profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_self_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Super admins can change anything
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- If the caller is updating their OWN profile, block changes to sensitive columns
  IF NEW.user_id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.access_status IS DISTINCT FROM OLD.access_status
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'Users cannot modify their own role, tenant, status, access_status or super admin flag'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_self_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_self_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_self_privilege_escalation();


-- 2) Restrict access_invites to tenant admins only (was admin OR head)
DROP POLICY IF EXISTS access_invites_admin_rw ON public.access_invites;
CREATE POLICY access_invites_admin_rw ON public.access_invites
  FOR ALL
  USING (
    (SELECT public.is_super_admin())
    OR (
      (SELECT public.is_tenant_active_member())
      AND tenant_id = (SELECT public.current_tenant_id())
      AND (SELECT public.is_tenant_admin())
    )
  )
  WITH CHECK (
    (SELECT public.is_super_admin())
    OR (
      (SELECT public.is_tenant_active_member())
      AND tenant_id = (SELECT public.current_tenant_id())
      AND (SELECT public.is_tenant_admin())
    )
  );


-- 3) macro-media storage: verify ownership via whatsapp_macros join for SELECT/DELETE
DROP POLICY IF EXISTS macro_media_select_tenant_isolated ON storage.objects;
CREATE POLICY macro_media_select_tenant_isolated ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'macro-media'
    AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR EXISTS (
        SELECT 1 FROM public.whatsapp_macros m
        WHERE m.media_path = storage.objects.name
          AND m.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
      )
    )
  );

DROP POLICY IF EXISTS macro_media_delete_tenant_isolated ON storage.objects;
CREATE POLICY macro_media_delete_tenant_isolated ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'macro-media'
    AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR EXISTS (
        SELECT 1 FROM public.whatsapp_macros m
        WHERE m.media_path = storage.objects.name
          AND m.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
      )
    )
  );

-- INSERT keeps the tenant-folder guard (row in whatsapp_macros doesn't exist yet at upload time)
-- but we also require the caller is an active tenant member (existing check preserved).


-- 4) ticket-attachments storage: verify via support_ticket_attachments join
DROP POLICY IF EXISTS ticket_attachments_select_tenant_isolated ON storage.objects;
CREATE POLICY ticket_attachments_select_tenant_isolated ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'ticket-attachments'
    AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR EXISTS (
        SELECT 1 FROM public.support_ticket_attachments a
        WHERE a.file_path = storage.objects.name
          AND a.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
      )
    )
  );

DROP POLICY IF EXISTS ticket_attachments_delete_tenant_isolated ON storage.objects;
CREATE POLICY ticket_attachments_delete_tenant_isolated ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'ticket-attachments'
    AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR EXISTS (
        SELECT 1 FROM public.support_ticket_attachments a
        WHERE a.file_path = storage.objects.name
          AND a.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
      )
    )
  );
