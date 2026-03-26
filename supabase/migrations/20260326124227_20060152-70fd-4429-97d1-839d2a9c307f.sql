
-- =====================================================================
-- A) agent_presence_set_active
-- =====================================================================
CREATE OR REPLACE FUNCTION public.agent_presence_set_active(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT status INTO v_old_status
  FROM public.support_agent_presence
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  INSERT INTO public.support_agent_presence (tenant_id, user_id, status, shift_started_at, updated_at)
  VALUES (p_tenant_id, v_uid, 'active', now(), now())
  ON CONFLICT (tenant_id, user_id) DO UPDATE SET
    status = 'active',
    shift_started_at = COALESCE(public.support_agent_presence.shift_started_at, now()),
    shift_ended_at = NULL,
    pause_reason_id = NULL,
    pause_started_at = NULL,
    pause_expected_end_at = NULL,
    updated_at = now();

  IF v_old_status IS NULL OR v_old_status = 'off' THEN
    INSERT INTO public.support_agent_presence_events (tenant_id, user_id, event_type)
    VALUES (p_tenant_id, v_uid, 'shift_start');
  ELSIF v_old_status = 'paused' THEN
    INSERT INTO public.support_agent_presence_events (tenant_id, user_id, event_type)
    VALUES (p_tenant_id, v_uid, 'pause_end');
  END IF;
END;
$$;

-- =====================================================================
-- B) agent_presence_set_pause
-- =====================================================================
CREATE OR REPLACE FUNCTION public.agent_presence_set_pause(
  p_tenant_id uuid,
  p_reason_id uuid,
  p_minutes int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.support_agent_presence SET
    status = 'paused',
    pause_reason_id = p_reason_id,
    pause_started_at = now(),
    pause_expected_end_at = now() + (p_minutes || ' minutes')::interval,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Presence row not found';
  END IF;

  INSERT INTO public.support_agent_presence_events
    (tenant_id, user_id, event_type, pause_reason_id, payload)
  VALUES
    (p_tenant_id, v_uid, 'pause_start', p_reason_id,
     jsonb_build_object('minutes', p_minutes));
END;
$$;

-- =====================================================================
-- C) agent_presence_extend_pause
-- =====================================================================
CREATE OR REPLACE FUNCTION public.agent_presence_extend_pause(
  p_tenant_id uuid,
  p_minutes int
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text;
  v_reason uuid;
  v_end timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT status, pause_reason_id, pause_expected_end_at
  INTO v_status, v_reason, v_end
  FROM public.support_agent_presence
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  IF v_status IS DISTINCT FROM 'paused' THEN
    RAISE EXCEPTION 'Agent is not paused';
  END IF;

  UPDATE public.support_agent_presence SET
    pause_expected_end_at = COALESCE(v_end, now()) + (p_minutes || ' minutes')::interval,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  INSERT INTO public.support_agent_presence_events
    (tenant_id, user_id, event_type, pause_reason_id, payload)
  VALUES
    (p_tenant_id, v_uid, 'pause_extend', v_reason,
     jsonb_build_object('minutes', p_minutes));
END;
$$;

-- =====================================================================
-- D) agent_presence_set_off
-- =====================================================================
CREATE OR REPLACE FUNCTION public.agent_presence_set_off(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.support_agent_presence SET
    status = 'off',
    shift_ended_at = now(),
    pause_reason_id = NULL,
    pause_started_at = NULL,
    pause_expected_end_at = NULL,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  INSERT INTO public.support_agent_presence_events (tenant_id, user_id, event_type)
  VALUES (p_tenant_id, v_uid, 'shift_end');
END;
$$;

-- =====================================================================
-- E) agent_presence_set_off_release_queue
-- =====================================================================
CREATE OR REPLACE FUNCTION public.agent_presence_set_off_release_queue(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[];
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT array_agg(id) INTO v_ids
  FROM public.support_attendances
  WHERE tenant_id = p_tenant_id
    AND assigned_to = v_uid
    AND status = 'in_progress';

  v_count := COALESCE(array_length(v_ids, 1), 0);

  IF v_count > 0 THEN
    UPDATE public.support_attendances SET
      status = 'waiting',
      assigned_to = NULL,
      assumed_at = NULL,
      updated_at = now()
    WHERE id = ANY(v_ids);

    INSERT INTO public.support_agent_presence_events
      (tenant_id, user_id, event_type, payload)
    VALUES
      (p_tenant_id, v_uid, 'shift_end_release_to_queue',
       jsonb_build_object('count', v_count, 'attendance_ids', to_jsonb(v_ids)));
  END IF;

  UPDATE public.support_agent_presence SET
    status = 'off',
    shift_ended_at = now(),
    pause_reason_id = NULL,
    pause_started_at = NULL,
    pause_expected_end_at = NULL,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  INSERT INTO public.support_agent_presence_events (tenant_id, user_id, event_type)
  VALUES (p_tenant_id, v_uid, 'shift_end');

  RETURN jsonb_build_object('released_count', v_count, 'attendance_ids', COALESCE(to_jsonb(v_ids), '[]'::jsonb));
END;
$$;

-- =====================================================================
-- Index composto (tenant + user + created_at) se nao existir
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_presence_events_tenant_user_created
ON public.support_agent_presence_events (tenant_id, user_id, created_at DESC);
