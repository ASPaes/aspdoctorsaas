-- Distribuicao: o pool de candidatos volta a respeitar o setor da conversa.
--
-- SINTOMA (Delvale, atendimento 00067/26 de 06/08/2026):
--   cliente escolhe "1 - Suporte Tecnico" na URA -> atendimento nasce em Suporte N1.
--   Klaivert (N1) nao aceita em 5 min -> reescala -> Arthur (N1) nao aceita -> reescala
--   -> cai em Leandro Flach, que e da COORDENACAO. O badge do chat vira "Coordenacao".
--
-- CAUSA:
--   fn_assign_conversation_if_ready montava o pool em dois ramos. Quando a instancia
--   estava ligada a mais de um setor em support_department_instances
--   (v_instance_dept_count > 1), o pool virava a UNIAO dos membros de TODOS esses
--   setores e o v_conv.department_id -- justamente o que a URA acabara de decidir --
--   era descartado. A instancia Delvale_Sup_8001 esta ligada a 6 setores, entao o
--   round-robin do N1 girava sobre a empresa inteira.
--
--   Esse ramo nunca teve um caso legitimo: a funcao ja retorna 'no_department' bem
--   acima quando o setor e nulo, entao department_id nunca chega ali indefinido.
--   Falta de agente livre no setor e responsabilidade do overflow_policy da regra
--   (queue / manual / fallback_agent), nao de trocar a equipe por baixo dos panos.
--
-- ALCANCE: 7 instancias multi-setor em 5 tenants (Delvale, CTM, Athuz, Liberty, ASP).
--   80 atribuicoes automaticas em 14 dias cairam em agente de fora do setor.
--
-- FIX: pool sempre restrito a v_conv.department_id. Nada mais muda.
--   Aplicado em producao em 06/08/2026.

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
$function$;
