
-- Function to accept an invite: creates profile + marks invite as used
-- Called by newly signed-up user after auth.signUp
CREATE OR REPLACE FUNCTION public.accept_invite(p_token uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite record;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Check if user already has a profile
  IF EXISTS (SELECT 1 FROM profiles WHERE user_id = v_user_id) THEN
    RAISE EXCEPTION 'User already has a profile';
  END IF;

  -- Find valid invite
  SELECT * INTO v_invite
  FROM invites
  WHERE token = p_token
    AND used_at IS NULL
    AND expires_at >= now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invite not found or expired';
  END IF;

  -- Create profile for the user
  INSERT INTO profiles (user_id, tenant_id, role, status)
  VALUES (v_user_id, v_invite.tenant_id, v_invite.role, 'ativo');

  -- Mark invite as used
  UPDATE invites SET used_at = now() WHERE id = v_invite.id;
END;
$$;
