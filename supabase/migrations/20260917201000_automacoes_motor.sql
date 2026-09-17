-- DEM-0410 | Automações do atendimento: o motor
--
-- Bloco 2 de 3. A partir daqui as regras da `automation_rules` passam a valer.
-- Enquanto a tabela estiver vazia (é o caso hoje), o comportamento do
-- roteamento é IDÊNTICO ao de antes.
--
-- O QUE ESTE ARQUIVO FAZ
--   1. Cria `fn_automation_resolve_chat_routing`: dado o chat, devolve a regra
--      vencedora já validada, grava o extrato e soma o contador.
--   2. Substitui `fn_assign_conversation_if_ready` (a de produção, lida hoje:
--      14705 bytes, md5 503f7119093dbfad5ea8f832bbc81fcb) acrescentando a
--      chamada acima. São 3 mudanças cirúrgicas, marcadas com DEM-0410.
--
-- ONDE A AUTOMAÇÃO ENTRA, E POR QUE AÍ
--   Depois do portão da URA (o setor já é o definitivo que o cliente escolheu)
--   e antes de ler a `assignment_rules`. Assim "manda para a fila do setor Y"
--   usa a regra de atribuição do PRÓPRIO Y, com a capacidade e a presença da
--   equipe dele, em vez de reimplementar essa decisão aqui.
--
-- REENTRÂNCIA (o detalhe que obriga a trava)
--   Trocar `whatsapp_conversations.department_id` dispara
--   `trg_dispatch_on_department_change`, que chama o motor OUTRA VEZ. Isso é
--   bom: é o segundo passe que escolhe o agente dentro do setor novo, reusando
--   o caminho que já existe. Mas duas regras cruzadas (A->B e B->A) fariam
--   ping-pong até estourar a pilha. A trava é uma variável LOCAL DA TRANSAÇÃO
--   (`set_config(..., is_local => true)`): um salto de automação por chat por
--   transação. O advisory lock que já existe no motor NÃO serve para isso:
--   ele é re-entrante na mesma transação, protege de sessão concorrente.
--
-- O QUE A AUTOMAÇÃO NÃO FAZ, DE PROPÓSITO
--   · Não cria setor onde não havia. Chat sem setor (URA pendente, ou canal
--     sem setor vinculado) sai do motor antes daqui e segue o caminho de hoje.
--     A automação TROCA o destino, não inventa um.
--   · Não pega grupo. Conversa de grupo nunca tem setor, então o motor já
--     retorna 'no_department' antes.
--   · Não mexe em atendimento em andamento. `assigned_to` preenchido sai do
--     motor lá em cima.
--   · Não vence a reabertura. `trg_restore_conv_assigned_on_reopen` devolve o
--     chat ao último agente sem passar por aqui (decisão do Alexandre,
--     mantida). Automação pega chat novo.
--   · Não cobre instância pessoal (`whatsapp_instances.default_operator_id`):
--     nesse caminho o processor atribui na edge function, sem motor.
--
-- EFEITO COLATERAL CONHECIDO da ação "pessoa específica": o
-- `trg_auto_department_on_assign` (BEFORE UPDATE em whatsapp_conversations)
-- reescreve o setor da conversa com o setor do agente sempre que `assigned_to`
-- muda. Ou seja, mandar o chat para alguém de outro setor move o chat para o
-- setor dessa pessoa. É o comportamento que já vale para qualquer atribuição
-- manual e combina com "1 agente = 1 setor"; fica registrado aqui porque
-- aparece no relatório por setor.

begin;

set local lock_timeout = '5s';

-- ─── 1. O resolvedor ────────────────────────────────────────────────────────

create or replace function public.fn_automation_resolve_chat_routing(
  p_conversation_id uuid,
  p_tenant_id       uuid,
  p_department_id   uuid,
  p_instance_id     uuid,
  p_attendance_id   uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_now             timestamptz := now();
  v_rule            public.automation_rules;
  v_would_be_agent  uuid;
  v_target_dept     uuid;
  v_target_agent    uuid;
  v_skip            text;
BEGIN
  IF p_tenant_id IS NULL OR p_conversation_id IS NULL OR p_department_id IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'sem_tenant_setor_ou_conversa');
  END IF;

  -- Regra que casa por PESSOA precisa saber para quem o chat iria. Hoje isso
  -- só é determinável quando a regra de atribuição do setor é 'fixed' (o
  -- rodízio e a menor carga só decidem depois, com presença e capacidade).
  -- O EXISTS abaixo roda no índice parcial e só cobra a segunda consulta do
  -- tenant que realmente tem regra por pessoa valendo agora.
  IF EXISTS (
    SELECT 1
      FROM public.automation_rules r
     WHERE r.tenant_id = p_tenant_id
       AND r.is_active
       AND r.match_agent_id IS NOT NULL
       AND (r.starts_at IS NULL OR r.starts_at <= v_now)
       AND (r.ends_at   IS NULL OR r.ends_at   >  v_now)
  ) THEN
    SELECT ar.fixed_agent_id
      INTO v_would_be_agent
      FROM public.assignment_rules ar
     WHERE ar.tenant_id     = p_tenant_id
       AND ar.department_id = p_department_id
       AND ar.is_active     = true
       AND ar.strategy      = 'fixed'
     LIMIT 1;
  END IF;

  -- A vencedora: menor prioridade, empate pela mais antiga.
  -- Condição nula = "qualquer". `match_agent_id = v_would_be_agent` com o
  -- segundo nulo dá NULL, que não é true: regra por pessoa não casa quando
  -- não se sabe para quem o chat ia. É o comportamento certo.
  SELECT r.*
    INTO v_rule
    FROM public.automation_rules r
   WHERE r.tenant_id = p_tenant_id
     AND r.is_active
     AND r.trigger_event = 'chat_inbound'
     AND (r.starts_at IS NULL OR r.starts_at <= v_now)
     AND (r.ends_at   IS NULL OR r.ends_at   >  v_now)
     AND (r.match_department_id IS NULL OR r.match_department_id = p_department_id)
     AND (r.match_instance_id   IS NULL OR r.match_instance_id   = p_instance_id)
     AND (r.match_agent_id      IS NULL OR r.match_agent_id      = v_would_be_agent)
   ORDER BY r.priority, r.created_at
   LIMIT 1;

  IF NOT FOUND THEN
    -- O caso normal. Não gera linha de extrato: seria uma por chat que entra.
    RETURN jsonb_build_object('matched', false);
  END IF;

  -- ─── Validação do destino ───
  IF v_rule.action = 'route_to_department' THEN
    SELECT d.id
      INTO v_target_dept
      FROM public.support_departments d
     WHERE d.id        = v_rule.target_department_id
       AND d.tenant_id = p_tenant_id
       AND d.is_active = true;

    IF v_target_dept IS NULL THEN
      v_skip := 'setor de destino inativo ou de outro tenant';
    ELSIF v_target_dept = p_department_id THEN
      -- Acontece com regra que casa só por canal: o chat já está no destino.
      v_skip := 'chat ja esta no setor de destino';
    END IF;

  ELSE
    -- Mesmo critério de perfil que o motor usa para o agente de backup
    -- (`status = 'ativo'`), para não existirem duas noções de "pessoa apta".
    -- Presença e capacidade NÃO entram: a regra é uma ordem explícita de
    -- alguém, não um palpite de balanceamento.
    SELECT p.user_id
      INTO v_target_agent
      FROM public.profiles p
     WHERE p.user_id   = v_rule.target_agent_id
       AND p.tenant_id = p_tenant_id
       AND p.status    = 'ativo';

    IF v_target_agent IS NULL THEN
      v_skip := 'pessoa de destino inativa ou de outro tenant';
    END IF;
  END IF;

  IF v_skip IS NOT NULL THEN
    -- Tentativa que não pegou é justamente a que gera dúvida na operação:
    -- fica registrada.
    INSERT INTO public.automation_rule_logs
      (tenant_id, rule_id, conversation_id, attendance_id, applied,
       from_department_id, skipped_reason)
    VALUES
      (p_tenant_id, v_rule.id, p_conversation_id, p_attendance_id, false,
       p_department_id, v_skip);

    RETURN jsonb_build_object(
      'matched', true, 'applied', false,
      'rule_id', v_rule.id, 'reason', v_skip);
  END IF;

  -- ─── Aplicou ───
  INSERT INTO public.automation_rule_logs
    (tenant_id, rule_id, conversation_id, attendance_id, applied,
     from_department_id, to_department_id, to_agent_id)
  VALUES
    (p_tenant_id, v_rule.id, p_conversation_id, p_attendance_id, true,
     p_department_id, v_target_dept, v_target_agent);

  UPDATE public.automation_rules
     SET applied_count   = applied_count + 1,
         last_applied_at = v_now
   WHERE id = v_rule.id;

  RETURN jsonb_build_object(
    'matched', true,
    'applied', true,
    'rule_id', v_rule.id,
    'rule_name', v_rule.name,
    'action', v_rule.action,
    'department_id', v_target_dept,
    'agent_id', v_target_agent);

EXCEPTION
  WHEN OTHERS THEN
    -- Automação com defeito NÃO pode impedir a distribuição normal do chat.
    RAISE LOG '[fn_automation_resolve_chat_routing] erro em conv %: %',
      p_conversation_id, SQLERRM;
    RETURN jsonb_build_object('matched', false, 'reason', 'erro', 'erro', SQLERRM);
END;
$function$;

COMMENT ON FUNCTION public.fn_automation_resolve_chat_routing(uuid, uuid, uuid, uuid, uuid) IS
  'DEM-0410: devolve a automação vencedora para um chat que esta entrando, ja validada, e grava o extrato. Chamada so por fn_assign_conversation_if_ready. Tem efeito colateral (extrato + contador): nao e read-only.';

-- Não é RPC de tela: tem efeito colateral e decide roteamento. O motor a
-- chama como SECURITY DEFINER (dono = postgres), então não precisa de grant
-- para authenticated, e é melhor que não tenha.
REVOKE ALL ON FUNCTION public.fn_automation_resolve_chat_routing(uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_automation_resolve_chat_routing(uuid, uuid, uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_automation_resolve_chat_routing(uuid, uuid, uuid, uuid, uuid) TO service_role;

-- ─── 2. O motor, com as 3 mudanças marcadas DEM-0410 ────────────────────────

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
      PERFORM set_config('doctorsaas.automation_hop', '1', true);

      -- Atendimento primeiro: sync_attendance_department so preenche quando
      -- esta nulo, entao esta escrita sobrevive, e o segundo passe do motor ja
      -- encontra o atendimento no setor certo.
      IF v_attendance.id IS NOT NULL THEN
        UPDATE public.support_attendances
           SET department_id = v_automation_dept,
               updated_at    = v_now
         WHERE id = v_attendance.id;
      END IF;

      -- Esta escrita dispara trg_dispatch_on_department_change, que chama o
      -- motor de novo. E de proposito: o segundo passe escolhe o agente dentro
      -- do setor novo, com a regra, a presenca e a capacidade dele.
      UPDATE public.whatsapp_conversations
         SET department_id = v_automation_dept,
             updated_at    = v_now
       WHERE id = v_conv.id;

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

  -- DEM-0410 (mudanca 2 de 3): `AND v_forced_agent IS NULL` nas duas saidas
  -- abaixo. Uma automacao que manda o chat para uma pessoa nao depende de o
  -- setor de origem ter regra de atribuicao configurada; sem esta condicao ela
  -- deixaria de valer justamente nos setores mal configurados, em silencio.
  IF NOT FOUND AND v_forced_agent IS NULL THEN
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

commit;

-- ─── Conferência (rodar depois, leitura pura) ───────────────────────────────
--
-- select
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname = 'fn_automation_resolve_chat_routing')          as resolvedor,   -- 1
--   (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname = 'fn_assign_conversation_if_ready')             as motor,        -- 1 (sem sobrecarga)
--   (select position('DEM-0410' in pg_get_functiondef(p.oid)) > 0
--      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--     where n.nspname = 'public'
--       and p.proname = 'fn_assign_conversation_if_ready')             as motor_com_patch,
--   (select count(*) from public.automation_rules where is_active)     as regras_ativas; -- 0
