
-- 1. Reforçar accept_invite: auditar + validar funcionario linkage
CREATE OR REPLACE FUNCTION public.accept_invite(p_token uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Note: access_status defaults to pending; trigger accept_access_invite_on_profile_insert
  -- will link funcionario_id if an access_invite exists for this email.
  -- The trg_profiles_audit_and_guard trigger will force access_status='pending'
  -- if funcionario_id is still null after insert.
  INSERT INTO profiles (user_id, tenant_id, role, status, access_status)
  VALUES (v_user_id, v_invite.tenant_id, v_invite.role, 'ativo', 'pending');

  -- Mark invite as used
  UPDATE invites SET used_at = now() WHERE id = v_invite.id;

  -- Audit: invite accepted
  INSERT INTO public.audit_events (tenant_id, actor_user_id, event_type, metadata)
  VALUES (
    v_invite.tenant_id,
    v_user_id,
    'INVITE_ACCEPTED',
    jsonb_build_object(
      'invite_id', v_invite.id,
      'email', v_invite.email,
      'role', v_invite.role
    )
  );
END;
$function$;

-- 2. Reforçar accept_access_invite_on_profile_insert: adicionar audit_log
CREATE OR REPLACE FUNCTION public.accept_access_invite_on_profile_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_email text;
  v_inv public.access_invites%rowtype;
begin
  -- pega email do auth.users
  select lower(btrim(u.email)) into v_email
  from auth.users u
  where u.id = new.user_id;

  if v_email is null or v_email = '' then
    return new;
  end if;

  -- acha convite pending por tenant + email
  select *
    into v_inv
  from public.access_invites ai
  where ai.tenant_id = new.tenant_id
    and lower(ai.email) = v_email
    and ai.status = 'pending'
  order by ai.invited_at desc
  limit 1;

  if not found then
    return new;
  end if;

  -- vincula funcionario/role/status no profile
  new.funcionario_id := v_inv.funcionario_id;
  new.role := coalesce(v_inv.metadata->>'role', new.role);
  new.access_status := coalesce(v_inv.metadata->>'access_status', new.access_status, 'ativo');

  -- Se funcionario_id ficou null, forçar pending (safety net)
  if new.funcionario_id is null then
    new.access_status := 'pending';
  end if;

  -- marca convite como aceito
  update public.access_invites
     set status = 'accepted',
         accepted_at = now(),
         auth_user_id = new.user_id,
         updated_at = now()
   where id = v_inv.id;

  -- Audit: access invite aceito com vinculação de funcionário
  insert into public.audit_events (tenant_id, actor_user_id, event_type, metadata)
  values (
    new.tenant_id,
    new.user_id,
    'ACCESS_INVITE_ACCEPTED',
    jsonb_build_object(
      'invite_id', v_inv.id,
      'email', v_email,
      'funcionario_id', v_inv.funcionario_id,
      'role', new.role,
      'access_status', new.access_status
    )
  );

  return new;
end;
$function$;

-- 3. Reforçar create_access_invite: adicionar audit_log explícito
CREATE OR REPLACE FUNCTION public.create_access_invite(p_funcionario_id bigint, p_email text, p_role text DEFAULT 'user'::text, p_access_status text DEFAULT 'ativo'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_tenant_id uuid;
  v_invite_id uuid;
  v_email text;
begin
  -- somente admin/head
  if not (public.is_admin_or_head() or public.is_super_admin()) then
    raise exception 'Somente Admin/Head pode convidar usuários';
  end if;

  v_email := lower(btrim(p_email));

  if v_email is null or v_email = '' then
    raise exception 'Email inválido';
  end if;

  if p_role not in ('user','admin','viewer') then
    raise exception 'Role inválido';
  end if;

  if p_access_status not in ('ativo','inativo') then
    raise exception 'Status inválido';
  end if;

  -- tenant do admin atual
  select p.tenant_id into v_tenant_id
  from public.profiles p
  where p.user_id = auth.uid();

  if v_tenant_id is null then
    raise exception 'Tenant não encontrado para o usuário autenticado';
  end if;

  -- valida funcionário no mesmo tenant
  perform 1
  from public.funcionarios f
  where f.id = p_funcionario_id
    and f.tenant_id = v_tenant_id;

  if not found then
    raise exception 'Funcionário não encontrado ou não pertence ao tenant';
  end if;

  -- Verificar se já existe profile ativo para este funcionário
  if exists (
    select 1 from public.profiles
    where funcionario_id = p_funcionario_id
      and tenant_id = v_tenant_id
      and access_status in ('active', 'ativo')
  ) then
    raise exception 'Este funcionário já possui usuário ativo vinculado';
  end if;

  -- upsert "pending" por funcionário (garantido pelo unique parcial)
  insert into public.access_invites (tenant_id, funcionario_id, email, status, invited_by, metadata)
  values (
    v_tenant_id,
    p_funcionario_id,
    v_email,
    'pending',
    auth.uid(),
    jsonb_build_object('role', p_role, 'access_status', p_access_status)
  )
  on conflict on constraint access_invites_one_pending_per_funcionario
  do update set
    email = excluded.email,
    invited_by = excluded.invited_by,
    resent_at = now(),
    metadata = excluded.metadata,
    updated_at = now()
  returning id into v_invite_id;

  -- Audit: convite criado
  insert into public.audit_events (tenant_id, actor_user_id, event_type, metadata)
  values (
    v_tenant_id,
    auth.uid(),
    'ACCESS_INVITE_CREATED',
    jsonb_build_object(
      'invite_id', v_invite_id,
      'email', v_email,
      'funcionario_id', p_funcionario_id,
      'role', p_role,
      'access_status', p_access_status
    )
  );

  return v_invite_id;
end;
$function$;
