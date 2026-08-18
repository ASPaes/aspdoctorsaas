-- Chat agendado: o relógio de "aguardando você" fica congelado até a hora marcada.
--
-- O agendamento (support_attendances.scheduled_until) já era respeitado pela
-- inatividade do cliente, pela capacidade do operador e pelo painel de métricas.
-- Três lugares ignoravam:
--   1. v_whatsapp_conversations_state.agent_alert_due_at  -> badge/anel vermelho
--   2. fn_notify_awaiting_agent (cron 66, */2)            -> notificação ao operador
--   3. fn_close_attendances_no_agent_response (cron 51)   -> ENCERRAVA o chat agendado
-- (3) está desligado nos 14 tenants hoje; ligar sem esta correção encerraria
-- sozinho um atendimento que o operador agendou de propósito.
--
-- Regra (decisão do owner, 18/08/2026): o relógio ZERA no instante do
-- agendamento e RETOMA na hora marcada — a contagem recomeça a partir de
-- scheduled_until, não do momento em que o cliente escreveu.

-- ---------------------------------------------------------------------------
-- 1. Fonte única do início do relógio
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_agent_clock_start(
  p_awaiting_since  timestamptz,
  p_scheduled_until timestamptz
)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- GREATEST ignora NULL: sem agendamento devolve o awaiting_agent_since cru.
  -- Com agendamento futuro devolve a hora marcada, e o prazo só passa a correr
  -- de lá em diante.
  SELECT GREATEST(p_awaiting_since, p_scheduled_until)
$$;

COMMENT ON FUNCTION public.fn_agent_clock_start(timestamptz, timestamptz) IS
  'Início do relógio de espera do agente. Agendamento zera a contagem e ela retoma em scheduled_until.';

REVOKE ALL ON FUNCTION public.fn_agent_clock_start(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_agent_clock_start(timestamptz, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. View de estado: badge, anel e pin no topo saem do agent_alert_due_at
--    Ganha scheduled_until/scheduled_at para a lista poder ordenar por agenda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_whatsapp_conversations_state AS
 SELECT wc.id AS conversation_id,
    wc.tenant_id,
    wc.status AS conversation_status,
    wc.department_id,
    wc.assigned_to AS conversation_assigned_to,
    wc.last_message_at,
    wc.last_message_preview,
    wc.unread_count,
    wc.opened_out_of_hours,
    wc.opened_out_of_hours_at,
    wc.first_agent_message_at,
    sa.id AS attendance_id,
    sa.status AS attendance_status,
    sa.assigned_to AS attendance_assigned_to,
    sa.opened_at AS attendance_opened_at,
    sa.unidade_base_id AS attendance_unidade_base_id,
    sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL AS attendance_has_customer_msg,
    sa.awaiting_agent_since,
    COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) AS agent_alert_enabled,
    COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes) AS agent_alert_minutes,
        CASE
            WHEN sa.awaiting_agent_since IS NOT NULL AND COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true THEN fn_business_due_at(public.fn_agent_clock_start(sa.awaiting_agent_since, sa.scheduled_until), COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes), wc.tenant_id, wc.department_id)
            ELSE NULL::timestamp with time zone
        END AS agent_alert_due_at,
    wc.is_group,
    sa.scheduled_until,
    sa.scheduled_at
   FROM whatsapp_conversations wc
     LEFT JOIN LATERAL ( SELECT s.id,
            s.status,
            s.assigned_to,
            s.opened_at,
            s.unidade_base_id,
            s.msg_customer_count,
            s.last_customer_message_at,
            s.awaiting_agent_since,
            s.scheduled_until,
            s.scheduled_at
           FROM support_attendances s
          WHERE s.conversation_id = wc.id AND s.tenant_id = wc.tenant_id AND (s.status = ANY (ARRAY['waiting'::text, 'in_progress'::text]))
          ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
         LIMIT 1) sa ON true
     LEFT JOIN support_departments dept ON dept.id = wc.department_id
     LEFT JOIN configuracoes cfg ON cfg.tenant_id = wc.tenant_id;

-- CREATE OR REPLACE VIEW descarta security_invoker em silêncio. Repor sempre.
ALTER VIEW public.v_whatsapp_conversations_state SET (security_invoker = on);

-- ---------------------------------------------------------------------------
-- 3. Notificação "Cliente esperando resposta" (cron 66)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notify_awaiting_agent()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_avisados int := 0;
BEGIN
  FOR v_row IN
    SELECT sa.id AS attendance_id, sa.assigned_to, wc.id AS conversation_id, wc.tenant_id,
           COALESCE(ct.name, ct.phone_number, 'Cliente') AS contato
    FROM public.support_attendances sa
    JOIN public.whatsapp_conversations wc ON wc.id = sa.conversation_id
    LEFT JOIN public.whatsapp_contacts ct ON ct.id = wc.contact_id
    LEFT JOIN public.support_departments dept ON dept.id = wc.department_id
    LEFT JOIN public.configuracoes cfg ON cfg.tenant_id = wc.tenant_id
    WHERE sa.awaiting_agent_since IS NOT NULL
      AND sa.agent_alert_notified_at IS NULL
      AND sa.assigned_to IS NOT NULL
      AND sa.status IN ('waiting','in_progress')
      AND COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true
      -- Agendado: nada de cutucar o operador antes da hora marcada.
      AND public.fn_business_due_at(
            public.fn_agent_clock_start(sa.awaiting_agent_since, sa.scheduled_until),
            COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes),
            wc.tenant_id, wc.department_id) <= now()
    FOR UPDATE OF sa SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.fn_notify_user(
        v_row.tenant_id, v_row.assigned_to, 'chat_awaiting_reply', 'warning',
        'Cliente esperando resposta',
        v_row.contato,
        '/whatsapp?conversation=' || v_row.conversation_id::text,
        jsonb_build_object('conversation_id', v_row.conversation_id,
                           'attendance_id', v_row.attendance_id),
        v_row.conversation_id);

      UPDATE public.support_attendances
         SET agent_alert_notified_at = now()
       WHERE id = v_row.attendance_id;

      v_avisados := v_avisados + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[fn_notify_awaiting_agent] falhou no atendimento %: %', v_row.attendance_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('avisados', v_avisados);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Encerramento por "agente não respondeu" (cron 51)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_close_attendances_no_agent_response()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_att RECORD;
  v_closed INT := 0;
  v_errors INT := 0;
  v_now TIMESTAMPTZ := now();
  v_started_at TIMESTAMPTZ := clock_timestamp();
  v_process_limit CONSTANT INT := 200;
BEGIN
  FOR v_att IN
    SELECT sa.id AS attendance_id,
           sa.tenant_id,
           sa.department_id,
           public.fn_agent_clock_start(sa.awaiting_agent_since, sa.scheduled_until) AS clock_start,
           COALESCE(dept.agent_no_response_close_minutes,
                    cfg.support_agent_no_response_close_minutes) AS close_minutes
    FROM support_attendances sa
    JOIN configuracoes cfg ON cfg.tenant_id = sa.tenant_id
    LEFT JOIN support_departments dept ON dept.id = sa.department_id
    LEFT JOIN whatsapp_contacts ct ON ct.id = sa.contact_id
    WHERE sa.status = 'in_progress'
      AND sa.is_group = false
      AND sa.awaiting_agent_since IS NOT NULL
      -- hold manual do operador: nao encerrar por inatividade de forma alguma
      AND COALESCE(sa.inactivity_hold, false) = false
      -- agendamento ativo: o operador marcou hora, nao e falta de resposta
      AND (sa.scheduled_until IS NULL OR sa.scheduled_until <= now())
      -- encerramento ligado (cascata setor > geral)
      AND COALESCE(dept.agent_no_response_close_enabled,
                   cfg.support_agent_no_response_close_enabled) = true
      -- contato sem "regras do sistema desligadas"
      AND COALESCE(ct.rules_disabled, false) = false
      -- PRECEDENCIA: nao encerrar enquanto o acceptance-timeout esta no controle
      AND NOT (
        sa.acceptance_deadline_at IS NOT NULL
        AND COALESCE(sa.msg_agent_count, 0) = 0
        AND sa.assigned_to IS NOT NULL
        AND COALESCE((cfg.support_config->>'distribution_enabled_globally')::boolean, false) = true
      )
    ORDER BY sa.awaiting_agent_since ASC
    LIMIT v_process_limit
  LOOP
    BEGIN
      IF public.segundos_uteis(v_att.clock_start, v_now, v_att.tenant_id, v_att.department_id)
         >= v_att.close_minutes * 60 THEN
        PERFORM public.fn_close_attendance_atomic(v_att.attendance_id, 'agent_no_response', 'agent_no_response');
        v_closed := v_closed + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE LOG '[fn_close_attendances_no_agent_response] erro no att %: %', v_att.attendance_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'closed', v_closed,
    'errors', v_errors,
    'elapsed_ms', EXTRACT(EPOCH FROM (clock_timestamp() - v_started_at)) * 1000,
    'ran_at', v_now
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Agendar zera o aviso já disparado, senão o alerta não reacende depois da hora
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.schedule_attendance(p_attendance_id uuid, p_scheduled_until timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_att RECORD;
  v_is_admin_or_head BOOLEAN;
  v_max_until TIMESTAMPTZ := now() + interval '60 days';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  -- Validação 1: data futura, não muito longa
  IF p_scheduled_until IS NULL THEN
    RAISE EXCEPTION 'scheduled_until_required' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_until <= now() THEN
    RAISE EXCEPTION 'scheduled_until_must_be_future' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_until > v_max_until THEN
    RAISE EXCEPTION 'scheduled_until_exceeds_max_60_days' USING ERRCODE = '22023';
  END IF;

  -- Buscar atendimento
  SELECT id, status, assigned_to, tenant_id
    INTO v_att
  FROM public.support_attendances
  WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attendance_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Validação 2: precisa estar in_progress
  IF v_att.status <> 'in_progress' THEN
    RAISE EXCEPTION 'attendance_must_be_in_progress' USING ERRCODE = '22023';
  END IF;

  -- Validação 3: permissão (admin/head do tenant OU assigned_to)
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = v_user_id
      AND p.tenant_id = v_att.tenant_id
      AND (p.role IN ('admin', 'head') OR p.is_super_admin = true)
  ) INTO v_is_admin_or_head;

  IF NOT v_is_admin_or_head AND v_att.assigned_to IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'forbidden_only_admin_head_or_assignee' USING ERRCODE = '42501';
  END IF;

  -- Aplicar
  UPDATE public.support_attendances
  SET scheduled_until = p_scheduled_until,
      scheduled_by    = v_user_id,
      scheduled_at    = now(),
      -- o relógio zera aqui: o aviso já dado não conta mais e volta a poder
      -- acender depois da hora marcada
      agent_alert_notified_at = NULL,
      updated_at      = now()
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'success', true,
    'attendance_id', p_attendance_id,
    'scheduled_until', p_scheduled_until,
    'scheduled_by', v_user_id,
    'scheduled_at', now()
  );
END $function$;

-- ---------------------------------------------------------------------------
-- 6. O CHECK de closed_reason não aceitava 'agent_no_response'
--
-- Mesma família do buraco de 'ura_encerrado'/'csat_completed' (fechado em
-- 14/08/2026), que ficou para trás. Com ele de pé, o cron 51 falharia em 100%
-- dos casos assim que alguém ligasse o encerramento por falta de resposta do
-- agente: fn_close_attendance_atomic estoura na constraint, o EXCEPTION da
-- fn_close_attendances_no_agent_response engole o erro e o resultado é
-- {closed: 0, errors: N} — nada encerrado, nada visível fora do log.
-- Medido no banco local em 18/08/2026: errors=3, closed=0.
--
-- Hoje o encerramento está desligado nos 14 tenants, então isto não muda
-- comportamento nenhum: só tira a armadilha do caminho.
-- 26.644 linhas / 36 MB: a validação é instantânea. lock_timeout porque ALTER
-- na fila bloqueia quem só quer LER a tabela.
SET LOCAL lock_timeout = '3s';

ALTER TABLE public.support_attendances
  DROP CONSTRAINT support_attendances_closed_reason_check;

ALTER TABLE public.support_attendances
  ADD CONSTRAINT support_attendances_closed_reason_check
  CHECK (closed_reason IS NULL OR closed_reason = ANY (ARRAY[
    'manual','inactivity','system','csat_timeout','csat_completed',
    'ura_encerrado','ura_autoatendimento','agent_no_response'
  ]));
