
-- RPC: validate_access_invite — returns invite info for signup page
CREATE OR REPLACE FUNCTION public.validate_access_invite(p_invite_id uuid)
RETURNS TABLE(email text, role text, tenant_id uuid, funcionario_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ai.email,
    COALESCE(ai.metadata->>'role', 'user')::text AS role,
    ai.tenant_id,
    ai.funcionario_id
  FROM public.access_invites ai
  WHERE ai.id = p_invite_id
    AND ai.status = 'pending'
    AND ai.tenant_id IS NOT NULL;
END;
$$;

-- RPC: accept_access_invite — called after signup to bind profile
CREATE OR REPLACE FUNCTION public.accept_access_invite(p_invite_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_invite RECORD;
  v_uid uuid := auth.uid();
  v_role text;
  v_access_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT * INTO v_invite
  FROM public.access_invites
  WHERE id = p_invite_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Convite não encontrado ou já utilizado';
  END IF;

  v_role := COALESCE(v_invite.metadata->>'role', 'user');
  v_access_status := COALESCE(v_invite.metadata->>'access_status', 'active');
  -- Normalize 'ativo' -> 'active'
  IF v_access_status = 'ativo' THEN
    v_access_status := 'active';
  END IF;

  -- Upsert profile for the authenticated user
  INSERT INTO public.profiles (user_id, tenant_id, role, access_status, funcionario_id, invited_by, invited_at)
  VALUES (v_uid, v_invite.tenant_id, v_role, v_access_status, v_invite.funcionario_id, v_invite.invited_by, v_invite.invited_at)
  ON CONFLICT (user_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    role = EXCLUDED.role,
    access_status = EXCLUDED.access_status,
    funcionario_id = EXCLUDED.funcionario_id,
    invited_by = EXCLUDED.invited_by,
    invited_at = EXCLUDED.invited_at;

  -- Mark invite as accepted
  UPDATE public.access_invites
  SET status = 'accepted',
      accepted_at = now(),
      auth_user_id = v_uid,
      updated_at = now()
  WHERE id = p_invite_id;

  -- Audit
  INSERT INTO public.audit_events (tenant_id, actor_user_id, event_type, metadata)
  VALUES (
    v_invite.tenant_id,
    v_uid,
    'ACCESS_INVITE_ACCEPTED',
    jsonb_build_object('invite_id', p_invite_id, 'funcionario_id', v_invite.funcionario_id, 'role', v_role)
  );
END;
$$;
