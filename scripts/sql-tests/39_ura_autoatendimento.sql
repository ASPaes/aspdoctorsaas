-- URA: a opção que responde e volta pro menu (ex.: "Indique e ganhe").
--
-- Quem escolhe uma opção 'auto_reply' recebe a mensagem configurada e fica em
-- ura_state='self_service': sem setor, sem atendente, fora da fila. Se voltar a
-- falar, o motor devolve o menu. Se sumir, fn_close_ura_selfservice fecha.
--
-- O que este teste protege:
--   1. Fecha só depois dos minutos configurados (não no primeiro ciclo do cron).
--   2. NÃO fecha quem voltou a falar. A leitura é pelo ESTADO: o motor tira de
--      'self_service' quando devolve o menu. Comparar last_customer_message_at
--      não serviria — quem grava esse campo é o incrementAttendanceCounter, que
--      roda DEPOIS do motor, então a própria mensagem que escolheu a opção
--      ficaria mais nova que ura_completed_at e nada fecharia nunca.
--   3. NÃO fecha de novo o que já foi encerrado e o cliente reabriu — por isso o
--      fechamento troca o estado para 'self_service_closed'.
--   4. NÃO fecha o que um atendente assumiu no meio.
--   5. Fecha com sentiment_at preenchido, senão o trg_enqueue_attendance_analysis
--      manda pra IA um chat de duas mensagens automáticas.
--   6. A conversa fecha junto.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/39_ura_autoatendimento.sql
BEGIN;

DO $$
DECLARE
  v_tenant   uuid := '71147475-27f5-43d4-80c7-6ae4b7008c49';  -- tem setor ativo e fila
  v_dept     uuid;
  v_vencido  uuid; v_novo uuid; v_falou uuid; v_assumido uuid; v_reaberto uuid; v_agente uuid;
  v_conv_venc uuid;
  v_fechados uuid[];
  v_msg      text;
  v_reason   text; v_sent timestamptz; v_conv_status text;
  v_na_fila_ia int;
  v_op        int := 9;
BEGIN
  -- ------------------------------------------------------------------ fixture
  -- Um setor do tenant vira a opção 9 de autoatendimento, 3 minutos de silêncio.
  SELECT id INTO v_dept FROM support_departments
   WHERE tenant_id = v_tenant AND is_active ORDER BY created_at LIMIT 1;
  IF v_dept IS NULL THEN RAISE EXCEPTION 'fixture: tenant sem setor ativo'; END IF;

  UPDATE support_departments
     SET ura_option_number = v_op, show_in_ura = true, ura_action = 'auto_reply',
         ura_auto_reply_message = 'Indique e ganhe: https://exemplo.com/indique',
         ura_auto_close_minutes = 3,
         ura_auto_close_message = 'Obrigado pela indicação! 💚'
   WHERE id = v_dept;
  -- Nenhum outro setor do tenant pode responder pela opção 9 (o JOIN é por número).
  UPDATE support_departments SET ura_option_number = NULL
   WHERE tenant_id = v_tenant AND id <> v_dept AND ura_option_number = v_op;

  -- Cinco atendimentos reais do tenant, colocados em cada estado.
  SELECT array_agg(id) INTO v_fechados FROM (
    SELECT id FROM support_attendances
     WHERE tenant_id = v_tenant AND status = 'waiting' ORDER BY id LIMIT 5
  ) s;
  IF array_length(v_fechados, 1) < 5 THEN RAISE EXCEPTION 'fixture: menos de 5 atendimentos waiting'; END IF;
  v_vencido := v_fechados[1]; v_novo := v_fechados[2];
  v_falou   := v_fechados[3]; v_assumido := v_fechados[4]; v_reaberto := v_fechados[5];

  UPDATE support_attendances
     SET ura_state='self_service', ura_option_selected=v_op, ura_selected_option=v_op,
         assigned_to=NULL, sentiment_at=NULL,
         ura_completed_at = now() - interval '5 min'
   WHERE id = v_vencido;

  UPDATE support_attendances                              -- ainda dentro dos 3 min
     SET ura_state='self_service', ura_option_selected=v_op, assigned_to=NULL,
         ura_completed_at = now() - interval '1 min'
   WHERE id = v_novo;

  -- Voltou a falar: o motor já devolveu o menu e tirou de 'self_service'.
  UPDATE support_attendances
     SET ura_state='pending', ura_option_selected=NULL, assigned_to=NULL,
         ura_completed_at = NULL, ura_asked_at = now() - interval '1 min'
   WHERE id = v_falou;

  -- Já encerrado antes e reaberto pelo cliente: volta a 'waiting' com o
  -- ura_completed_at velho, mas o estado guarda que a despedida já saiu.
  UPDATE support_attendances
     SET ura_state='self_service_closed', ura_option_selected=v_op, assigned_to=NULL,
         ura_completed_at = now() - interval '30 min', reopened_at = now() - interval '1 min'
   WHERE id = v_reaberto;

  SELECT user_id INTO v_agente FROM profiles WHERE tenant_id = v_tenant LIMIT 1;
  IF v_agente IS NULL THEN RAISE EXCEPTION 'fixture: tenant sem profile'; END IF;
  UPDATE support_attendances                              -- atendente assumiu
     SET ura_state='self_service', ura_option_selected=v_op, assigned_to = v_agente,
         ura_completed_at = now() - interval '5 min', last_customer_message_at = NULL
   WHERE id = v_assumido;

  SELECT conversation_id INTO v_conv_venc FROM support_attendances WHERE id = v_vencido;
  UPDATE whatsapp_conversations SET status='active' WHERE id = v_conv_venc;
  DELETE FROM attendance_analysis_queue WHERE attendance_id = ANY(v_fechados);

  -- -------------------------------------------------------------------- ação
  SELECT array_agg(attendance_id), max(mensagem)
    INTO v_fechados, v_msg
    FROM public.fn_close_ura_selfservice(50);

  -- ------------------------------------------------------------------ provas
  IF NOT (v_vencido = ANY(COALESCE(v_fechados, '{}'))) THEN
    RAISE EXCEPTION 'FALHOU: o vencido (5 min de silêncio) não foi encerrado';
  END IF;
  IF v_novo = ANY(COALESCE(v_fechados, '{}')) THEN
    RAISE EXCEPTION 'FALHOU: encerrou antes dos 3 minutos configurados';
  END IF;
  IF v_falou = ANY(COALESCE(v_fechados, '{}')) THEN
    RAISE EXCEPTION 'FALHOU: encerrou quem voltou a falar';
  END IF;
  IF v_assumido = ANY(COALESCE(v_fechados, '{}')) THEN
    RAISE EXCEPTION 'FALHOU: encerrou atendimento que um atendente assumiu';
  END IF;
  IF v_reaberto = ANY(COALESCE(v_fechados, '{}')) THEN
    RAISE EXCEPTION 'FALHOU: encerrou de novo um atendimento reaberto — o cliente levaria outra despedida';
  END IF;
  IF v_msg IS DISTINCT FROM 'Obrigado pela indicação! 💚' THEN
    RAISE EXCEPTION 'FALHOU: mensagem de encerramento veio "%"', v_msg;
  END IF;

  SELECT closed_reason, sentiment_at INTO v_reason, v_sent
    FROM support_attendances WHERE id = v_vencido;
  IF v_reason IS DISTINCT FROM 'ura_autoatendimento' THEN
    RAISE EXCEPTION 'FALHOU: closed_reason "%"', v_reason;
  END IF;
  IF v_sent IS NULL THEN
    RAISE EXCEPTION 'FALHOU: sentiment_at NULL — o chat iria pra fila da IA';
  END IF;

  SELECT status INTO v_conv_status FROM whatsapp_conversations WHERE id = v_conv_venc;
  IF v_conv_status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'FALHOU: conversa ficou "%"', v_conv_status;
  END IF;

  SELECT count(*) INTO v_na_fila_ia FROM attendance_analysis_queue WHERE attendance_id = v_vencido;
  IF v_na_fila_ia > 0 THEN
    RAISE EXCEPTION 'FALHOU: entrou na fila da IA';
  END IF;

  RAISE EXCEPTION 'SMOKE_OK | encerrou o vencido | poupou: dentro do prazo, quem voltou a falar, quem foi assumido, o reaberto | sem IA | conversa fechada';
END $$;

ROLLBACK;
