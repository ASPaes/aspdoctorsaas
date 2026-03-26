
-- Fix agent_presence_set_off: change status from 'off' to 'offline'
CREATE OR REPLACE FUNCTION public.agent_presence_set_off(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.support_agent_presence SET
    status = 'offline',
    shift_ended_at = now(),
    pause_reason_id = NULL,
    pause_started_at = NULL,
    pause_expected_end_at = NULL,
    updated_at = now()
  WHERE tenant_id = p_tenant_id AND user_id = v_uid;

  INSERT INTO public.support_agent_presence_events (tenant_id, user_id, event_type)
  VALUES (p_tenant_id, v_uid, 'shift_end');
END;
$function$;

-- Fix agent_presence_set_off_release_queue: change status from 'off' to 'offline'
CREATE OR REPLACE FUNCTION public.agent_presence_set_off_release_queue(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
    status = 'offline',
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
$function$;
