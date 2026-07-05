
-- 1) access_invites: restringir a authenticated
DROP POLICY IF EXISTS access_invites_admin_rw ON public.access_invites;
CREATE POLICY access_invites_admin_rw ON public.access_invites
  FOR ALL TO authenticated
  USING ((SELECT is_super_admin()) OR ((SELECT is_tenant_active_member()) AND (tenant_id = (SELECT current_tenant_id())) AND (SELECT is_tenant_admin())))
  WITH CHECK ((SELECT is_super_admin()) OR ((SELECT is_tenant_active_member()) AND (tenant_id = (SELECT current_tenant_id())) AND (SELECT is_tenant_admin())));

-- 2) invites: restringir a authenticated
DROP POLICY IF EXISTS invites_select ON public.invites;
DROP POLICY IF EXISTS invites_insert ON public.invites;
DROP POLICY IF EXISTS invites_update ON public.invites;
DROP POLICY IF EXISTS invites_delete ON public.invites;

CREATE POLICY invites_select ON public.invites
  FOR SELECT TO authenticated
  USING ((((SELECT is_tenant_admin()) AND (tenant_id = (SELECT current_tenant_id()))) OR (SELECT is_super_admin())));

CREATE POLICY invites_insert ON public.invites
  FOR INSERT TO authenticated
  WITH CHECK (((((SELECT is_tenant_admin()) AND (tenant_id = (SELECT current_tenant_id()))) OR (SELECT is_super_admin())) AND can_invite_more_users(tenant_id)));

CREATE POLICY invites_update ON public.invites
  FOR UPDATE TO authenticated
  USING ((((SELECT is_tenant_admin()) AND (tenant_id = (SELECT current_tenant_id()))) OR (SELECT is_super_admin())))
  WITH CHECK ((((SELECT is_tenant_admin()) AND (tenant_id = (SELECT current_tenant_id()))) OR (SELECT is_super_admin())));

CREATE POLICY invites_delete ON public.invites
  FOR DELETE TO authenticated
  USING ((((SELECT is_tenant_admin()) AND (tenant_id = (SELECT current_tenant_id()))) OR (SELECT is_super_admin())));

-- 3) profiles: prevenir auto-escalação de privilégios via trigger
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_super boolean := COALESCE((SELECT public.is_super_admin()), false);
  v_is_tenant_admin boolean := COALESCE((SELECT public.is_tenant_admin()), false);
BEGIN
  -- Super admins podem tudo
  IF v_is_super THEN
    RETURN NEW;
  END IF;

  -- Se o usuário está editando o próprio perfil, bloqueia mudança de campos sensíveis
  IF NEW.user_id = v_uid THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin
       OR NEW.access_status IS DISTINCT FROM OLD.access_status THEN
      RAISE EXCEPTION 'Você não pode alterar seu próprio papel, status de super admin ou status de acesso'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- Alterando perfil de outro usuário: exige tenant admin e nunca pode conceder super admin
    IF NOT v_is_tenant_admin THEN
      RAISE EXCEPTION 'Apenas administradores podem alterar perfis de outros usuários'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin AND NEW.is_super_admin = true THEN
      RAISE EXCEPTION 'Apenas super admins podem conceder status de super admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();

-- 4) macro-media: adicionar política UPDATE espelhando SELECT/DELETE
DROP POLICY IF EXISTS macro_media_update_tenant_isolated ON storage.objects;
CREATE POLICY macro_media_update_tenant_isolated ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    (bucket_id = 'macro-media') AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR (EXISTS (SELECT 1 FROM public.whatsapp_macros m WHERE m.media_path = objects.name AND m.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)))
    )
  )
  WITH CHECK (
    (bucket_id = 'macro-media') AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR (EXISTS (SELECT 1 FROM public.whatsapp_macros m WHERE m.media_path = objects.name AND m.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)))
    )
  );

-- 5) ticket-attachments: adicionar política UPDATE espelhando SELECT/DELETE
DROP POLICY IF EXISTS ticket_attachments_update_tenant_isolated ON storage.objects;
CREATE POLICY ticket_attachments_update_tenant_isolated ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    (bucket_id = 'ticket-attachments') AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR (EXISTS (SELECT 1 FROM public.support_ticket_attachments a WHERE a.file_path = objects.name AND a.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)))
    )
  )
  WITH CHECK (
    (bucket_id = 'ticket-attachments') AND (
      (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_super_admin = true))
      OR (EXISTS (SELECT 1 FROM public.support_ticket_attachments a WHERE a.file_path = objects.name AND a.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)))
    )
  );
