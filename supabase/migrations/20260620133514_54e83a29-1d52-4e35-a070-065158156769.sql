
CREATE OR REPLACE FUNCTION public.prevent_profile_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin boolean;
  is_super boolean;
BEGIN
  is_super := COALESCE((SELECT public.is_super_admin()), false);
  is_admin := COALESCE((SELECT public.is_tenant_admin()), false);
  IF is_super OR is_admin THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id = auth.uid() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.access_status IS DISTINCT FROM OLD.access_status
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
      RAISE EXCEPTION 'Não é permitido alterar role, is_super_admin, access_status, tenant_id ou approved_by no próprio perfil';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_self_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_self_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_self_escalation();

DROP POLICY IF EXISTS "wa_media_insert_debug_open" ON storage.objects;

DROP POLICY IF EXISTS "macro_media_select" ON storage.objects;
DROP POLICY IF EXISTS "macro_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "macro_media_delete" ON storage.objects;

CREATE POLICY "macro_media_select_tenant_isolated"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'macro-media'
  AND (
    (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
    OR (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
);

CREATE POLICY "macro_media_insert_tenant_isolated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'macro-media'
  AND (
    (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
    OR (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
);

CREATE POLICY "macro_media_delete_tenant_isolated"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'macro-media'
  AND (
    (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
    OR (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "Authenticated deletes m6jz3j_0" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated deletes m6jz3j_1" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated reads m6jz3j_0" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated uploads m6jz3j_0" ON storage.objects;

CREATE POLICY "ticket_attachments_select_tenant_isolated"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (
    (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
    OR (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
);

CREATE POLICY "ticket_attachments_insert_tenant_isolated"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'ticket-attachments'
  AND (
    (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
    OR (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
);

CREATE POLICY "ticket_attachments_delete_tenant_isolated"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'ticket-attachments'
  AND (
    (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
    OR (storage.foldername(name))[1] = (SELECT p.tenant_id::text FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
);

DROP POLICY IF EXISTS "tenant_manage_invites" ON public.invites;
DROP POLICY IF EXISTS "tenant_manage_access_invites" ON public.access_invites;

CREATE POLICY "personas_tenant_select"
ON public.conselho_personas FOR SELECT TO authenticated
USING (public.is_super_admin() OR public.is_tenant_active_member());
