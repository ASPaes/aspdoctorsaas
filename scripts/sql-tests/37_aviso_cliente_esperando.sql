-- Cliente esperando resposta avisa o dono do chat, uma vez só (13/08/2026).
--
-- agent_alert_due_at já era calculado (por setor, em horário útil) mas só pintava
-- badge na lista. A marca agent_alert_notified_at nasce e morre com
-- awaiting_agent_since, então a mesma espera nunca avisa duas vezes.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/37_aviso_cliente_esperando.sql
BEGIN;

DO $$
DECLARE
  v_att uuid; v_conv uuid; v_tenant uuid; v_user uuid; v_dept uuid;
  v_n int; v_res jsonb;
BEGIN
  -- ── fixture: atendimento em andamento, com dono, num setor com alerta ligado
  SELECT sa.id, sa.conversation_id, sa.tenant_id, sa.assigned_to, c.department_id
    INTO v_att, v_conv, v_tenant, v_user, v_dept
  FROM public.support_attendances sa
  JOIN public.whatsapp_conversations c ON c.id = sa.conversation_id
  WHERE sa.status = 'in_progress' AND sa.assigned_to IS NOT NULL
    AND c.department_id IS NOT NULL
  ORDER BY sa.created_at DESC LIMIT 1;
  IF v_att IS NULL THEN RAISE EXCEPTION 'PRE: nenhum atendimento em andamento com dono e setor'; END IF;

  -- o setor precisa estar com o alerta ligado, senão o due_at é NULL de propósito
  UPDATE public.support_departments
     SET agent_alert_enabled = true, agent_alert_minutes = 5
   WHERE id = v_dept;

  -- espera antiga o bastante para vencer o prazo mesmo contando só horário útil
  UPDATE public.support_attendances
     SET awaiting_agent_since = now() - interval '30 days',
         agent_alert_notified_at = NULL
   WHERE id = v_att;

  -- ── 1ª passada: avisa
  v_res := public.fn_notify_awaiting_agent();
  IF COALESCE((v_res->>'avisados')::int, 0) < 1 THEN
    RAISE EXCEPTION 'VENCIDO: nao avisou ninguem, retorno %', v_res;
  END IF;

  SELECT count(*) INTO v_n
  FROM public.notifications n
  JOIN public.notification_recipients nr ON nr.notification_id = n.id
  WHERE n.type = 'chat_awaiting_reply' AND n.conversation_id = v_conv AND nr.user_id = v_user;
  IF v_n <> 1 THEN RAISE EXCEPTION 'VENCIDO: esperado 1 aviso ao dono, veio %', v_n; END IF;

  IF (SELECT agent_alert_notified_at FROM public.support_attendances WHERE id = v_att) IS NULL THEN
    RAISE EXCEPTION 'MARCA: agent_alert_notified_at continuou nulo';
  END IF;

  -- ── 2ª passada: NÃO repete
  PERFORM public.fn_notify_awaiting_agent();
  SELECT count(*) INTO v_n
  FROM public.notifications n
  JOIN public.notification_recipients nr ON nr.notification_id = n.id
  WHERE n.type = 'chat_awaiting_reply' AND n.conversation_id = v_conv AND nr.user_id = v_user;
  IF v_n <> 1 THEN RAISE EXCEPTION 'REPETICAO: avisou % vezes pela mesma espera', v_n; END IF;

  -- ── o operador responde: a marca tem que zerar junto com a espera
  UPDATE public.support_attendances
     SET last_customer_message_at = now() - interval '10 minutes',
         last_operator_message_at = now()
   WHERE id = v_att;

  IF (SELECT awaiting_agent_since FROM public.support_attendances WHERE id = v_att) IS NOT NULL THEN
    RAISE EXCEPTION 'RESET: resposta do operador deveria ter zerado awaiting_agent_since';
  END IF;
  IF (SELECT agent_alert_notified_at FROM public.support_attendances WHERE id = v_att) IS NOT NULL THEN
    RAISE EXCEPTION 'RESET: resposta do operador deveria ter zerado agent_alert_notified_at';
  END IF;

  RAISE NOTICE 'SMOKE_OK: avisa uma vez, nao repete, e reseta na resposta';
END $$;


-- ── chat SEM dono nao entra: fila e assunto da regra 2
DO $$
DECLARE
  v_att uuid; v_conv uuid; v_dept uuid; v_n int;
BEGIN
  SELECT sa.id, sa.conversation_id, c.department_id INTO v_att, v_conv, v_dept
  FROM public.support_attendances sa
  JOIN public.whatsapp_conversations c ON c.id = sa.conversation_id
  WHERE sa.status IN ('waiting','in_progress') AND sa.assigned_to IS NULL
    AND c.department_id IS NOT NULL
  ORDER BY sa.created_at DESC LIMIT 1;
  IF v_att IS NULL THEN
    RAISE NOTICE 'SKIP: nenhum atendimento sem dono na base para este caso';
    RETURN;
  END IF;

  UPDATE public.support_departments SET agent_alert_enabled = true, agent_alert_minutes = 5
   WHERE id = v_dept;
  UPDATE public.support_attendances
     SET awaiting_agent_since = now() - interval '30 days', agent_alert_notified_at = NULL
   WHERE id = v_att;

  PERFORM public.fn_notify_awaiting_agent();

  SELECT count(*) INTO v_n FROM public.notifications
   WHERE type = 'chat_awaiting_reply' AND conversation_id = v_conv;
  IF v_n <> 0 THEN RAISE EXCEPTION 'SEM DONO: chat na fila nao pode gerar aviso de espera, veio %', v_n; END IF;

  RAISE NOTICE 'SMOKE_OK: chat sem dono nao gera aviso de espera';
END $$;

ROLLBACK;
