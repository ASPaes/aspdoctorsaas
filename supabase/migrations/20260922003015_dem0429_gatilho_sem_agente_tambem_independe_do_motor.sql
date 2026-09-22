-- DEM-0429 (correção) | O gatilho "setor ficou sem ninguém conectado" também
--                       vale com o motor de distribuição pausado.
--
-- A migration 20260921234909 tirou a dependência do motor só do gatilho
-- "chat entra no atendimento" e retornava logo depois. Isso deixava a tela
-- oferecendo uma regra que não funcionava: o modelo "Setor ficou sem ninguém"
-- e a opção "Setor ficou sem ninguém conectado" no dialog existem desde
-- 17/09/2026 (8031b759), e a pasta local em que a decisão foi tomada estava
-- num commit anterior a ele.
--
-- O argumento para excluir o gatilho também estava errado: ele NÃO depende de
-- distribuição. fn_automation_try_no_agent decide por PRESENÇA (ninguém do
-- setor com heartbeat recente nos últimos 20 min), carência (grace_minutes) e
-- expediente do setor. Com o motor pausado os agentes continuam tendo presença,
-- então a condição segue significando o que promete e não dispara em todo chat.
--
-- Duas mudanças, as duas em fn_assign_conversation_if_ready:
--
-- 1. A saída barata do kill-switch deixa de filtrar `trigger_event`. Um tenant
--    que tenha SÓ regra de "setor sem ninguém" saía ali e a regra nunca era
--    avaliada.
--
-- 2. O gatilho passa a rodar no portão do motor pausado, e não nos pontos 4a/4b
--    lá embaixo. Assim o motor pausado avalia a regra sem percorrer regra de
--    atribuição, pool, capacidade e overflow — e sem chance de atribuir agente
--    por conta própria, que é justamente o que "pausado" quer dizer.
--    Destino de pessoa segue pelo ramo de v_forced_agent, que já ignora pool e
--    overflow e grava a nota.
--
-- Nada mais da função mudou em relação ao que está em produção agora.
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
  v_ura_enabled BOOLEAN;
  v_skip_ura BOOLEAN;
  v_conv_is_group BOOLEAN;
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
  -- DEM-0410
  v_automation JSONB;
  v_forced_agent UUID;
  v_automation_dept UUID;
  v_rule_found BOOLEAN;
  -- DEM-0429
  v_somente_automacao BOOLEAN := false;
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

  -- ─── DEM-0429: a aba Automacoes nao e a aba Atribuicao ────────────────────
  -- Uma regra de transferencia de chat vale mesmo com o motor de distribuicao
  -- pausado: sao duas telas e duas decisoes diferentes, e 12 dos 16 tenants
  -- operam com o motor pausado. O portao do kill-switch desceu para depois do
  -- bloco de automacao (marcado DEM-0429 mais abaixo).
  --
  -- Este EXISTS existe por custo, nao por regra: com o motor pausado e sem
  -- nenhuma regra valendo — que e o caso de todos os tenants hoje — a funcao
  -- continua saindo daqui com UMA sondagem de indice
  -- (idx_automation_rules_lookup), em vez de percorrer o resto do caminho.
  -- retry-waiting-conversations chama isto todo minuto para cada chat parado.
  IF v_config_kill_switch IS DISTINCT FROM true THEN
    IF NOT EXISTS (
      SELECT 1
        FROM public.automation_rules r
       WHERE r.tenant_id = v_conv.tenant_id
         AND r.is_active
         AND (r.starts_at IS NULL OR r.starts_at <= v_now)
         AND (r.ends_at   IS NULL OR r.ends_at   >  v_now)
    ) THEN
      RETURN jsonb_build_object('skipped', 'kill_switch_off');
    END IF;
    v_somente_automacao := true;
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

  SELECT id, ura_state, ura_completed_at, created_from
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

    -- 14/08/2026: a checagem acima e cega justamente na janela que importa.
    -- O atendimento nasce com ura_state = 'none' (DEFAULT da coluna; o INSERT do
    -- processor nao passa o campo) e 'none' esta na lista de "URA resolvida" —
    -- entao o AFTER INSERT distribuia o chat ~1s ANTES de o menu chegar ao cliente,
    -- e a opcao digitada depois era descartada (handleUraResponse so le 'waiting').
    -- Enquanto a URA for a dona do roteamento, quem tira o atendimento daqui e o
    -- cliente escolhendo o setor ou o timeout (fn_process_ura_timeouts) — nunca o
    -- motor de distribuicao.
    IF NOT v_ura_is_pending
       AND v_attendance.ura_completed_at IS NULL
       AND v_attendance.created_from = 'customer'
       AND COALESCE(v_attendance.ura_state, 'none') IN ('none','pending') THEN

      SELECT COALESCE(c.is_group, false) INTO v_conv_is_group
      FROM public.whatsapp_conversations c
      WHERE c.id = p_conversation_id;

      IF COALESCE(v_conv_is_group, false) = false THEN
        SELECT COALESCE(cfg.support_ura_enabled, cfg.ura_enabled, false)
          INTO v_ura_enabled
        FROM public.configuracoes cfg
        WHERE cfg.tenant_id = v_conv.tenant_id;

        -- Mesma regra das 3 triggers de setor (sync_conversation_department,
        -- fn_auto_assign_dept_by_instance, fn_reroute_dept_by_instance_on_customer_att):
        -- instancia com skip_ura nao passa pela URA. Nesse caso o processor ja abre
        -- o atendimento como 'in_progress' e nem chega aqui — a checagem mantem as
        -- duas pontas com a mesma regra em vez de depender desse detalhe.
        SELECT COALESCE(i.skip_ura, false) INTO v_skip_ura
        FROM public.whatsapp_conversations c
        JOIN public.whatsapp_instances i
          ON i.id = COALESCE(c.current_instance_id, c.instance_id)
        WHERE c.id = p_conversation_id;

        IF COALESCE(v_ura_enabled, false) = true
           AND COALESCE(v_skip_ura, false) = false THEN
          v_ura_is_pending := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_ura_is_pending THEN
    RETURN jsonb_build_object('skipped', 'ura_pending', 'ura_state', v_attendance.ura_state);
  END IF;

  -- ─── DEM-0410 (mudanca 1 de 3): automacoes ────────────────────────────────
  -- Aqui o setor ja e o definitivo (a URA, se existe, ja decidiu) e a regra de
  -- atribuicao ainda nao foi lida: trocar o setor agora faz o chat ser
  -- distribuido pela regra do setor NOVO.
  --
  -- A trava e local da transacao. Sem ela, duas regras cruzadas (A->B e B->A)
  -- entrariam em ping-pong via trg_dispatch_on_department_change ate estourar
  -- a pilha. O advisory lock la em cima nao resolve isso: ele e re-entrante na
  -- mesma transacao.
  IF COALESCE(current_setting('doctorsaas.automation_hop', true), '') <> '1' THEN
    v_automation := public.fn_automation_resolve_chat_routing(
      v_conv.id, v_conv.tenant_id, v_conv.department_id, v_conv.instance_id,
      v_attendance.id);

    IF (v_automation->>'action') = 'route_to_department' THEN
      v_automation_dept := (v_automation->>'department_id')::uuid;
      -- Trava + atendimento + conversa, nessa ordem. Ver a funcao.
      PERFORM public.fn_automation_reroute_department(
        v_conv.id, v_attendance.id, v_automation_dept);

      -- DEM-0429: o desvio nao deixava rastro nenhum no chat. Ele nao grava em
      -- conversation_assignments, entao nem o selo "Transferido de setor"
      -- aparecia: o chat simplesmente surgia em outro setor.
      PERFORM public.fn_automation_add_note(
        v_conv.tenant_id, v_conv.id, v_automation->>'rule_name',
        v_conv.department_id, v_automation_dept, NULL);

      RETURN jsonb_build_object(
        'rerouted_by_automation', true,
        'rule_id', v_automation->>'rule_id',
        'rule_name', v_automation->>'rule_name',
        'from_department_id', v_conv.department_id,
        'to_department_id', v_automation_dept,
        'attendance_id', v_attendance.id);

    ELSIF (v_automation->>'action') = 'route_to_agent' THEN
      PERFORM set_config('doctorsaas.automation_hop', '1', true);
      v_forced_agent := (v_automation->>'agent_id')::uuid;
    END IF;
  END IF;

  -- ─── DEM-0429: aqui acaba a automacao e comeca a distribuicao ─────────────
  -- Com o motor pausado, o que vem daqui para baixo (regra de atribuicao, pool,
  -- presenca, capacidade, overflow) e distribuicao, e distribuicao continua
  -- pausada. Mas o gatilho "setor ficou sem ninguem conectado" TAMBEM e da aba
  -- Automacoes — a tela oferece o modelo desde 17/09/2026 (8031b759) — e ele
  -- nao depende de distribuicao nenhuma: fn_automation_try_no_agent decide por
  -- PRESENCA (ninguem do setor com heartbeat recente), carencia e expediente.
  --
  -- Por isso ele roda AQUI, e nao la embaixo nos pontos 4a/4b: assim o motor
  -- pausado avalia a regra sem percorrer pool nem overflow, e sem chance de
  -- atribuir agente por conta propria.
  --
  -- Correcao de 22/09/2026: a primeira versao do DEM-0429 retornava direto aqui
  -- e deixava esse gatilho de fora. A tela oferecia uma regra que nao funcionava.
  IF v_somente_automacao AND v_forced_agent IS NULL THEN
    IF COALESCE(current_setting('doctorsaas.automation_hop', true), '') <> '1' THEN
      v_automation := public.fn_automation_try_no_agent(
        v_conv.id, v_conv.tenant_id, v_conv.department_id, v_conv.instance_id,
        v_attendance.id);

      IF (v_automation->>'action') = 'route_to_department' THEN
        v_automation_dept := (v_automation->>'department_id')::uuid;
        PERFORM public.fn_automation_reroute_department(
          v_conv.id, v_attendance.id, v_automation_dept);
        PERFORM public.fn_automation_add_note(
          v_conv.tenant_id, v_conv.id, v_automation->>'rule_name',
          v_conv.department_id, v_automation_dept, NULL);
        RETURN jsonb_build_object(
          'rerouted_by_automation', true,
          'trigger', 'no_agent_available',
          'motor_pausado', true,
          'rule_id', v_automation->>'rule_id',
          'rule_name', v_automation->>'rule_name',
          'from_department_id', v_conv.department_id,
          'to_department_id', v_automation_dept,
          'attendance_id', v_attendance.id);

      ELSIF (v_automation->>'action') = 'route_to_agent' THEN
        -- Segue o fluxo abaixo com destino forcado: o ramo de v_forced_agent
        -- pula pool, presenca, capacidade e overflow, e atribui.
        PERFORM set_config('doctorsaas.automation_hop', '1', true);
        v_forced_agent := (v_automation->>'agent_id')::uuid;
      END IF;
    END IF;

    IF v_forced_agent IS NULL THEN
      RETURN jsonb_build_object('skipped', 'kill_switch_off', 'automacao_avaliada', true);
    END IF;
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

  -- FOUND muda a cada PERFORM/SELECT seguinte; guardado aqui porque o gatilho
  -- abaixo roda consultas antes de a saida "sem regra" ser decidida.
  v_rule_found := FOUND;

  -- ─── DEM-0410 (mudanca 4a): gatilho "setor sem agente", setor SEM regra ───
  -- Setor sem regra de atribuicao sai daqui direto para a fila. Se o gatilho
  -- so olhasse o pool vazio (mudanca 4b), deixaria de valer justamente nesses
  -- setores, em silencio.
  IF NOT v_rule_found AND v_forced_agent IS NULL
     AND COALESCE(current_setting('doctorsaas.automation_hop', true), '') <> '1' THEN
    v_automation := public.fn_automation_try_no_agent(
      v_conv.id, v_conv.tenant_id, v_conv.department_id, v_conv.instance_id,
      v_attendance.id);

    IF (v_automation->>'action') = 'route_to_department' THEN
      v_automation_dept := (v_automation->>'department_id')::uuid;
      PERFORM public.fn_automation_reroute_department(
        v_conv.id, v_attendance.id, v_automation_dept);
      PERFORM public.fn_automation_add_note(
        v_conv.tenant_id, v_conv.id, v_automation->>'rule_name',
        v_conv.department_id, v_automation_dept, NULL);
      RETURN jsonb_build_object(
        'rerouted_by_automation', true,
        'trigger', 'no_agent_available',
        'rule_id', v_automation->>'rule_id',
        'rule_name', v_automation->>'rule_name',
        'from_department_id', v_conv.department_id,
        'to_department_id', v_automation_dept,
        'attendance_id', v_attendance.id);
    ELSIF (v_automation->>'action') = 'route_to_agent' THEN
      PERFORM set_config('doctorsaas.automation_hop', '1', true);
      v_forced_agent := (v_automation->>'agent_id')::uuid;
    END IF;
  END IF;

  -- DEM-0410 (mudanca 2 de 3): `AND v_forced_agent IS NULL` nas duas saidas
  -- abaixo. Uma automacao que manda o chat para uma pessoa nao depende de o
  -- setor de origem ter regra de atribuicao configurada; sem esta condicao ela
  -- deixaria de valer justamente nos setores mal configurados, em silencio.
  IF NOT v_rule_found AND v_forced_agent IS NULL THEN
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

  IF v_rule.strategy IS NULL AND v_forced_agent IS NULL THEN
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

  -- DEM-0410 (mudanca 3 de 3): o IF/ELSE em volta do pool.
  IF v_forced_agent IS NOT NULL THEN
    -- Automacao com destino de pessoa: a intencao e explicita, entao ignora
    -- pool, presenca, capacidade e overflow_policy. O resolvedor ja conferiu
    -- que o perfil esta ativo no tenant. Sem este desvio, o bloco de overflow
    -- abaixo poderia descartar a escolha ('manual' retorna, 'fallback_agent'
    -- sobrescreve) exatamente quando o setor de origem esta sem ninguem, que e
    -- o caso em que a regra existe.
    v_chosen_agent := v_forced_agent;
    v_strategy := 'automation_agent';
  ELSE
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

      -- ─── DEM-0410 (mudanca 4b): gatilho "setor sem agente", pool vazio ───
      -- Chega aqui so quem ia para a fila: 'manual' ja retornou acima e o
      -- agente de backup valido ja foi escolhido. O proprio gatilho confere se
      -- o pool esta vazio por AUSENCIA (ninguem conectado), nao por pausa ou
      -- lotacao.
      IF v_chosen_agent IS NULL
         AND COALESCE(current_setting('doctorsaas.automation_hop', true), '') <> '1' THEN
        v_automation := public.fn_automation_try_no_agent(
          v_conv.id, v_conv.tenant_id, v_conv.department_id, v_conv.instance_id,
          v_attendance.id);

        IF (v_automation->>'action') = 'route_to_department' THEN
          v_automation_dept := (v_automation->>'department_id')::uuid;
          PERFORM public.fn_automation_reroute_department(
            v_conv.id, v_attendance.id, v_automation_dept);
          PERFORM public.fn_automation_add_note(
            v_conv.tenant_id, v_conv.id, v_automation->>'rule_name',
            v_conv.department_id, v_automation_dept, NULL);
          RETURN jsonb_build_object(
            'rerouted_by_automation', true,
            'trigger', 'no_agent_available',
            'rule_id', v_automation->>'rule_id',
            'rule_name', v_automation->>'rule_name',
            'from_department_id', v_conv.department_id,
            'to_department_id', v_automation_dept,
            'attendance_id', v_attendance.id);
        ELSIF (v_automation->>'action') = 'route_to_agent' THEN
          PERFORM set_config('doctorsaas.automation_hop', '1', true);
          v_chosen_agent := (v_automation->>'agent_id')::uuid;
          v_strategy := 'automation_no_agent';
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

  -- DEM-0429: destino de pessoa tambem ganha nota. O selo "Distribuido para X"
  -- que aparece no chat e o mesmo da distribuicao normal: ele nao diz que foi
  -- uma automacao, nem qual.
  IF v_strategy IN ('automation_agent', 'automation_no_agent') THEN
    PERFORM public.fn_automation_add_note(
      v_conv.tenant_id, v_conv.id, v_automation->>'rule_name',
      NULL, NULL, v_chosen_agent);
  END IF;

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
    'instance_dept_count', v_instance_dept_count,
    'automation_rule_id', v_automation->>'rule_id'
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

COMMENT ON FUNCTION public.fn_assign_conversation_if_ready(uuid) IS
  'Core do motor de distribuição. Idempotente e safe: verifica pré-condições, busca regra, aplica estratégia e atribui OU enfileira. Protegida por advisory lock anti-concorrência. Retorna JSON com decisão. DEM-0429: os DOIS gatilhos de automação (chat_inbound e no_agent_available) são avaliados antes do kill-switch e valem com o motor pausado.';
