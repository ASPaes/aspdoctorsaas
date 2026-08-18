-- Chat agendado não pode acender "Aguardando você", notificar o operador nem ser
-- encerrado por "agente não respondeu" antes da hora marcada.
--
-- 18/08/2026: o agendamento (support_attendances.scheduled_until) já era respeitado
-- pela inatividade do cliente, pela capacidade e pelo painel — mas NÃO pelo relógio
-- do agente. Um chat agendado para as 15:00 aparecia com anel vermelho e badge
-- "Aguardando você" às 13:45, e o cron 51 (desligado hoje) o encerraria sozinho.
--
-- Regra: o relógio zera no agendamento e retoma em scheduled_until.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/41_chat_agendado_pausa_relogio.sql
BEGIN;

DO $$
DECLARE
  v_att uuid; v_conv uuid; v_tenant uuid; v_dept uuid;
  v_due timestamptz; v_due_sem_agenda timestamptz;
  v_sched timestamptz; v_status text; v_notif int; v_notif_antes int;
BEGIN
  -- ---------------------------------------------------------------- fixture
  -- Atendimento real, 1:1, com cliente (senão fn_block_close_without_cliente
  -- barra o encerramento do caso de controle e o teste mente).
  SELECT sa.id, sa.conversation_id, sa.tenant_id, wc.department_id
    INTO v_att, v_conv, v_tenant, v_dept
    FROM public.support_attendances sa
    JOIN public.whatsapp_conversations wc ON wc.id = sa.conversation_id
    JOIN public.whatsapp_contacts ct ON ct.id = sa.contact_id
   WHERE sa.status = 'in_progress'
     AND COALESCE(sa.is_group, false) = false
     AND sa.assigned_to IS NOT NULL
     AND sa.cliente_id IS NOT NULL
     AND COALESCE(ct.rules_disabled, false) = false
     AND COALESCE(sa.inactivity_hold, false) = false
   LIMIT 1;
  IF v_att IS NULL THEN
    RAISE EXCEPTION 'PRE: nenhum atendimento in_progress 1:1 com cliente na base local';
  END IF;

  -- Alerta e encerramento ligados no tenant; sem override de setor atravessando.
  UPDATE public.configuracoes
     SET support_agent_alert_enabled = true,
         support_agent_alert_minutes = 5,
         support_agent_no_response_close_enabled = true,
         support_agent_no_response_close_minutes = 60
   WHERE tenant_id = v_tenant;
  IF v_dept IS NOT NULL THEN
    UPDATE public.support_departments
       SET agent_alert_enabled = NULL, agent_alert_minutes = NULL,
           agent_no_response_close_enabled = NULL, agent_no_response_close_minutes = NULL
     WHERE id = v_dept;
  END IF;

  -- Cliente esperando há 30 dias: horário útil sobra em qualquer hora que o teste rode.
  UPDATE public.support_attendances
     SET awaiting_agent_since = now() - interval '30 days',
         agent_alert_notified_at = NULL,
         scheduled_until = NULL, scheduled_at = NULL, scheduled_by = NULL
   WHERE id = v_att;

  -- ------------------------------------------------- 1. controle: sem agenda
  SELECT s.agent_alert_due_at INTO v_due_sem_agenda
    FROM public.v_whatsapp_conversations_state s WHERE s.conversation_id = v_conv;
  IF v_due_sem_agenda IS NULL OR v_due_sem_agenda > now() THEN
    RAISE EXCEPTION 'CONTROLE: sem agenda o alerta deveria estar aceso (due=%)', v_due_sem_agenda;
  END IF;

  -- ------------------------------------------------- 2. agenda futura apaga
  v_sched := now() + interval '3 days';
  UPDATE public.support_attendances
     SET scheduled_until = v_sched, scheduled_at = now()
   WHERE id = v_att;

  SELECT s.agent_alert_due_at INTO v_due
    FROM public.v_whatsapp_conversations_state s WHERE s.conversation_id = v_conv;
  IF v_due IS NULL OR v_due <= now() THEN
    RAISE EXCEPTION 'FALHA 1: chat agendado até % ainda acende "Aguardando você" (due=%)', v_sched, v_due;
  END IF;
  IF v_due < v_sched THEN
    RAISE EXCEPTION 'FALHA 2: o relógio não retomou na hora marcada (due=% < agenda=%)', v_due, v_sched;
  END IF;

  -- ------------------------------------------- 3. cron 66 não cutuca antes da hora
  -- Delta, não total: a base local é cópia da produção e o atendimento escolhido
  -- pode já ter notificação antiga.
  SELECT count(*) INTO v_notif_antes FROM public.notifications n
   WHERE n.type = 'chat_awaiting_reply'
     AND n.metadata->>'attendance_id' = v_att::text;
  PERFORM public.fn_notify_awaiting_agent();
  SELECT count(*) INTO v_notif FROM public.notifications n
   WHERE n.type = 'chat_awaiting_reply'
     AND n.metadata->>'attendance_id' = v_att::text;
  IF v_notif > v_notif_antes THEN
    RAISE EXCEPTION 'FALHA 3: fn_notify_awaiting_agent notificou % vez(es) um chat agendado', v_notif - v_notif_antes;
  END IF;
  IF (SELECT agent_alert_notified_at FROM public.support_attendances WHERE id = v_att) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 3b: agent_alert_notified_at foi carimbado durante o agendamento';
  END IF;

  -- ------------------------------------------- 4. cron 51 não encerra o agendado
  PERFORM public.fn_close_attendances_no_agent_response();
  SELECT status INTO v_status FROM public.support_attendances WHERE id = v_att;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'FALHA 4: chat agendado foi encerrado por agent_no_response (status=%)', v_status;
  END IF;

  -- --------------------------------- 5. controle do 4: sem agenda, encerra mesmo
  -- Depende do CHECK de closed_reason aceitar 'agent_no_response' (seção 6 da
  -- migration 20260818160000). Sem ela este controle falha, e é assim que ele
  -- prova que o cron 51 realmente encerraria se não fosse a agenda.
  UPDATE public.support_attendances
     SET scheduled_until = NULL, scheduled_at = NULL, status = 'in_progress'
   WHERE id = v_att;
  PERFORM public.fn_close_attendances_no_agent_response();
  SELECT status INTO v_status FROM public.support_attendances WHERE id = v_att;
  IF v_status = 'in_progress' THEN
    RAISE EXCEPTION 'CONTROLE 5: sem agenda o encerramento deveria ter ocorrido — teste não prova nada';
  END IF;

  RAISE NOTICE 'OK — agendamento congela alerta, notificação e encerramento (att=%)', v_att;
END $$;

ROLLBACK;
