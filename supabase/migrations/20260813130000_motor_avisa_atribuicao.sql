-- Helper único de notificação por usuário + o motor passa a avisar (13/08/2026).
--
-- Regra 4 da spec de notificações. fn_assign_conversation_if_ready atribuía a
-- conversa sem avisar ninguém — só o caminho manual do frontend criava o aviso.
--
-- fn_notify_user existe para as regras 3, 4, 5 e 6 não repetirem os dois INSERTs.
-- Ele NÃO decide destinatário: quem chama já sabe para quem é.
--
-- ⚠️ O corpo de fn_assign_conversation_if_ready abaixo foi reconstruído a partir
-- de PRODUÇÃO (md5 c89b649271f6f7d956ba266d068de014), não do banco local: o local
-- estava atrasado, ainda com o ramo "multi-setor" que saiu de prod em 06/08 e que
-- espalhava atendimento para fora da equipe. A única diferença em relação a prod
-- é o bloco de aviso marcado como "Regra 4".
CREATE OR REPLACE FUNCTION public.fn_notify_user(
  p_tenant_id uuid,
  p_user_id uuid,
  p_type text,
  p_severity text,
  p_title text,
  p_body text,
  p_action_url text,
  p_metadata jsonb,
  p_conversation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_notif uuid;
BEGIN
  IF p_user_id IS NULL OR p_tenant_id IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.notifications (
    tenant_id, type, severity, title, body, action_url, conversation_id, metadata
  ) VALUES (
    p_tenant_id, p_type, COALESCE(p_severity,'info'), p_title, p_body,
    p_action_url, p_conversation_id, COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_notif;

  INSERT INTO public.notification_recipients (tenant_id, notification_id, user_id, silent_mode)
  VALUES (p_tenant_id, v_notif, p_user_id, false);

  RETURN v_notif;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_notify_user(uuid,uuid,text,text,text,text,text,jsonb,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_notify_user(uuid,uuid,text,text,text,text,text,jsonb,uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_user(uuid,uuid,text,text,text,text,text,jsonb,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.fn_assign_conversation_if_ready(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conv RECORD;
  v_rule RECORD;
  v_config_kill_switch BOOLEAN;
  v_tenant_timeout INT;
  v_effective_timeout INT;
  v_attendance RECORD;
  v_ura_is_pending BOOLEAN := false;
  v_candidates UUID[];
  v_chosen_agent UUID;
  v_strategy TEXT;
  v_priority_int INT;
  v_rr_index INT;
  v_queue_reason TEXT := 'initial_enqueue';
  v_attendance_id UUID;
  v_now TIMESTAMPTZ := now();
  v_instance_dept_count INT := 0;
  v_heartbeat_threshold INTERVAL := interval '20 minutes';
BEGIN
  IF p_conversation_id IS NULL THEN
    RETURN jsonb_build_object('skipped', 'null_conversation_id');
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('assign:' || p_conversation_id::text)) THEN
    RETURN jsonb_build_object('skipped', 'concurrent_call');
  END IF;

  SELECT id, tenant_id, department_id, status, assigned_to,
         instance_id, priority
    INTO v_conv
  FROM public.whatsapp_conversations
  WHERE id = p_conversation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'conversation_not_found');
  END IF;

  SELECT COALESCE((support_config->>'distribution_enabled_globally')::BOOLEAN, false)
    INTO v_config_kill_switch
  FROM public.configuracoes
  WHERE tenant_id = v_conv.tenant_id;

  IF v_config_kill_switch IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('skipped', 'kill_switch_off');
  END IF;

  IF v_conv.status = 'closed' OR v_conv.status = 'inactive_closed' THEN
    RETURN jsonb_build_object('skipped', 'outbound_or_closed', 'status', v_conv.status);
  END IF;

  IF v_conv.assigned_to IS NOT NULL THEN
    RETURN jsonb_build_object('skipped', 'already_assigned', 'agent_id', v_conv.assigned_to);
  END IF;

  IF v_conv.department_id IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no_department');
  END IF;

  SELECT id, ura_state, ura_completed_at
    INTO v_attendance
  FROM public.support_attendances
  WHERE conversation_id = p_conversation_id
    AND status = 'waiting'
  ORDER BY opened_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    IF v_attendance.ura_completed_at IS NULL
       AND v_attendance.ura_state IS NOT NULL
       AND v_attendance.ura_state NOT IN ('completed','skipped','none','bypassed','timeout_fallback') THEN
      v_ura_is_pending := true;
    END IF;
  END IF;

  IF v_ura_is_pending THEN
    RETURN jsonb_build_object('skipped', 'ura_pending', 'ura_state', v_attendance.ura_state);
  END IF;

  SELECT id, strategy, fixed_agent_id, round_robin_last_index,
         excluded_agents, required_skills,
         overflow_policy, fallback_agent_id,
         acceptance_timeout_seconds, respect_business_hours
    INTO v_rule
  FROM public.assignment_rules
  WHERE tenant_id = v_conv.tenant_id
    AND department_id = v_conv.department_id
    AND is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    v_priority_int := CASE v_conv.priority
      WHEN 'high' THEN 2 WHEN 'normal' THEN 1 WHEN 'low' THEN 0 ELSE 1 END;
    IF v_attendance.id IS NOT NULL THEN
      UPDATE public.support_attendances
      SET queued_at = COALESCE(queued_at, v_now),
          queue_priority = v_priority_int,
          last_queue_reason = 'no_active_rule',
          updated_at = v_now
      WHERE id = v_attendance.id;
    END IF;
    RETURN jsonb_build_object(
      'queued', true,
      'reason', 'no_active_rule_for_department',
      'attendance_id', v_attendance.id
    );
  END IF;

  IF v_rule.strategy IS NULL THEN
    RETURN jsonb_build_object('skipped', 'rule_strategy_not_set');
  END IF;

  v_strategy := v_rule.strategy;

  IF v_rule.respect_business_hours = true
     AND NOT public.fn_is_business_hours(v_conv.tenant_id) THEN
    v_priority_int := CASE v_conv.priority
      WHEN 'high' THEN 2 WHEN 'normal' THEN 1 WHEN 'low' THEN 0
      ELSE 1 END;

    IF v_attendance.id IS NOT NULL THEN
      UPDATE public.support_attendances
      SET queued_at = COALESCE(queued_at, v_now),
          queue_priority = v_priority_int,
          last_queue_reason = 'initial_enqueue',
          updated_at = v_now
      WHERE id = v_attendance.id;
    END IF;

    RETURN jsonb_build_object(
      'queued', true,
      'reason', 'out_of_business_hours',
      'attendance_id', v_attendance.id
    );
  END IF;

  SELECT COALESCE((support_config->>'default_acceptance_timeout_seconds')::INT, 60)
    INTO v_tenant_timeout
  FROM public.configuracoes
  WHERE tenant_id = v_conv.tenant_id;

  v_effective_timeout := COALESCE(v_rule.acceptance_timeout_seconds, v_tenant_timeout, 60);

  IF v_conv.instance_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_instance_dept_count
    FROM support_department_instances
    WHERE instance_id = v_conv.instance_id
      AND tenant_id = v_conv.tenant_id
      AND is_active = true;
  END IF;

  -- Pool SEMPRE restrito ao setor da conversa (o que a URA/roteamento decidiu).
  --
  -- Ate 06/08/2026 existia aqui um ramo "multi-setor": quando a instancia estava
  -- ligada a mais de um setor (v_instance_dept_count > 1), o pool virava a UNIAO
  -- dos membros de TODOS esses setores e o v_conv.department_id era descartado.
  -- Como a funcao ja retorna 'no_department' bem acima quando o setor e nulo,
  -- esse ramo nunca teve um caso legitimo: ele so espalhava o atendimento para
  -- fora da equipe (ex.: chat da URA "Suporte Tecnico" caindo na Coordenacao).
  -- Falta de agente livre no setor e responsabilidade do overflow_policy da regra,
  -- nao de trocar a equipe por baixo do panos.
  SELECT ARRAY(
    SELECT m.user_id
    FROM public.support_department_members m
    JOIN public.profiles p
      ON p.user_id = m.user_id AND p.tenant_id = v_conv.tenant_id
    JOIN public.support_agent_presence pr
      ON pr.user_id = m.user_id AND pr.tenant_id = v_conv.tenant_id
    WHERE m.department_id = v_conv.department_id
      AND m.tenant_id = v_conv.tenant_id
      AND m.is_active = true
      AND p.status = 'ativo'
      AND pr.status = 'active'
      AND pr.last_heartbeat_at > v_now - v_heartbeat_threshold
      AND m.user_id <> ALL(COALESCE(v_rule.excluded_agents, ARRAY[]::UUID[]))
      AND (
        COALESCE(array_length(v_rule.required_skills, 1), 0) = 0
        OR v_rule.required_skills <@ COALESCE(p.skills, ARRAY[]::TEXT[])
      )
      AND public.fn_current_chat_count(m.user_id, v_conv.tenant_id)
          < public.fn_effective_chat_limit(m.user_id, v_conv.tenant_id)
  ) INTO v_candidates;

  IF v_candidates IS NULL OR array_length(v_candidates, 1) IS NULL THEN
    IF v_rule.overflow_policy = 'manual' THEN
      RETURN jsonb_build_object('skipped', 'overflow_manual', 'rule_id', v_rule.id);
    END IF;

    IF v_rule.overflow_policy = 'fallback_agent' AND v_rule.fallback_agent_id IS NOT NULL THEN
      PERFORM 1 FROM public.profiles
        WHERE user_id = v_rule.fallback_agent_id AND tenant_id = v_conv.tenant_id
          AND status = 'ativo';
      IF FOUND THEN
        v_chosen_agent := v_rule.fallback_agent_id;
      ELSE
        v_rule.overflow_policy := 'queue';
      END IF;
    END IF;

    IF v_chosen_agent IS NULL THEN
      v_priority_int := CASE v_conv.priority
        WHEN 'high' THEN 2 WHEN 'normal' THEN 1 WHEN 'low' THEN 0
        ELSE 1 END;

      IF v_attendance.id IS NOT NULL THEN
        UPDATE public.support_attendances
        SET queued_at = COALESCE(queued_at, v_now),
            queue_priority = v_priority_int,
            last_queue_reason = 'initial_enqueue',
            updated_at = v_now
        WHERE id = v_attendance.id;
      END IF;

      RETURN jsonb_build_object(
        'queued', true,
        'reason', 'no_eligible_agents',
        'attendance_id', v_attendance.id
      );
    END IF;
  END IF;

  IF v_chosen_agent IS NULL THEN
    IF v_strategy = 'fixed' THEN
      IF v_rule.fixed_agent_id IS NOT NULL
         AND v_rule.fixed_agent_id = ANY(v_candidates) THEN
        v_chosen_agent := v_rule.fixed_agent_id;
      ELSE
        IF v_rule.overflow_policy = 'fallback_agent'
           AND v_rule.fallback_agent_id IS NOT NULL
           AND v_rule.fallback_agent_id = ANY(v_candidates) THEN
          v_chosen_agent := v_rule.fallback_agent_id;
        ELSIF v_rule.overflow_policy = 'manual' THEN
          RETURN jsonb_build_object('skipped', 'fixed_agent_unavailable_manual');
        ELSE
          v_priority_int := CASE v_conv.priority
            WHEN 'high' THEN 2 WHEN 'normal' THEN 1 WHEN 'low' THEN 0
            ELSE 1 END;
          IF v_attendance.id IS NOT NULL THEN
            UPDATE public.support_attendances
            SET queued_at = COALESCE(queued_at, v_now),
                queue_priority = v_priority_int,
                last_queue_reason = 'initial_enqueue',
                updated_at = v_now
            WHERE id = v_attendance.id;
          END IF;
          RETURN jsonb_build_object('queued', true, 'reason', 'fixed_agent_unavailable');
        END IF;
      END IF;

    ELSIF v_strategy = 'round_robin' THEN
      v_rr_index := COALESCE(v_rule.round_robin_last_index, -1) + 1;
      v_rr_index := v_rr_index % array_length(v_candidates, 1);
      v_chosen_agent := v_candidates[v_rr_index + 1];
      UPDATE public.assignment_rules
        SET round_robin_last_index = v_rr_index, updated_at = v_now
        WHERE id = v_rule.id;

    ELSIF v_strategy IN ('least_loaded','skill_based') THEN
      SELECT u INTO v_chosen_agent
      FROM unnest(v_candidates) AS u
      ORDER BY public.fn_current_chat_count(u, v_conv.tenant_id) ASC,
               random()
      LIMIT 1;

    ELSE
      RETURN jsonb_build_object('error', 'unknown_strategy', 'strategy', v_strategy);
    END IF;
  END IF;

  IF v_chosen_agent IS NULL THEN
    RETURN jsonb_build_object('error', 'no_agent_chosen');
  END IF;

  UPDATE public.whatsapp_conversations
     SET assigned_to = v_chosen_agent,
         updated_at = v_now
   WHERE id = v_conv.id
     AND assigned_to IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', 'race_conflict_conversation_already_assigned');
  END IF;

  IF v_attendance.id IS NOT NULL THEN
    UPDATE public.support_attendances
       SET assigned_to = v_chosen_agent,
           status = 'in_progress',
           assumed_at = COALESCE(assumed_at, v_now),
           acceptance_deadline_at = v_now + make_interval(secs => v_effective_timeout),
           queued_at = NULL,
           updated_at = v_now
     WHERE id = v_attendance.id;
    v_attendance_id := v_attendance.id;
  END IF;

  INSERT INTO public.conversation_assignments (
    tenant_id, conversation_id, assigned_to, assigned_by,
    reason, created_at
  ) VALUES (
    v_conv.tenant_id, v_conv.id, v_chosen_agent, NULL,
    'auto', v_now
  );

  -- Regra 4: avisa quem recebeu o chat. Nunca avisa quem causou a acao — aqui
  -- assigned_by e NULL (o motor), entao nao ha autor para excluir.
  BEGIN
    PERFORM public.fn_notify_user(
      v_conv.tenant_id,
      v_chosen_agent,
      'chat_assignment',
      'info',
      'Novo atendimento atribuido',
      COALESCE((SELECT COALESCE(ct.name, ct.phone_number)
                  FROM public.whatsapp_contacts ct
                  JOIN public.whatsapp_conversations cv ON cv.contact_id = ct.id
                 WHERE cv.id = v_conv.id), 'Contato')
        || COALESCE(' • ' || (SELECT d.name FROM public.support_departments d
                               WHERE d.id = v_conv.department_id), ''),
      '/whatsapp?conversation=' || v_conv.id::text,
      jsonb_build_object(
        'conversation_id', v_conv.id,
        'department_id', v_conv.department_id,
        'assigned_by', NULL,
        'reason', 'auto'),
      v_conv.id);
  EXCEPTION WHEN OTHERS THEN
    -- Aviso e efeito colateral: falhar aqui nao pode desfazer a atribuicao.
    RAISE LOG '[fn_assign_conversation_if_ready] notify falhou em conv %: %', v_conv.id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'assigned', true,
    'agent_id', v_chosen_agent,
    'strategy', v_strategy,
    'rule_id', v_rule.id,
    'attendance_id', v_attendance_id,
    'acceptance_deadline_at', v_now + make_interval(secs => v_effective_timeout),
    'effective_timeout_seconds', v_effective_timeout,
    'department_id', v_conv.department_id,
    'instance_dept_count', v_instance_dept_count
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG '[fn_assign_conversation_if_ready] Erro em conv %: %', p_conversation_id, SQLERRM;
    RETURN jsonb_build_object(
      'error', SQLERRM,
      'conversation_id', p_conversation_id
    );
END;
$function$
;
