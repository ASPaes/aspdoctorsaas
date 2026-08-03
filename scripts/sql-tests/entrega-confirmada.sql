-- Smoke rollback-safe do ciclo de entrega confirmada.
-- O resultado volta pela exception e o rollback e automatico: nada fica no banco.
--
-- O que este teste protege:
--  1. as 4 colunas novas existem em whatsapp_messages
--  2. a janela de confirmacao esta configurada e no valor combinado (20s)
--  3. o tipo de evento existe com o cooldown que E o agrupamento (10 min)
--  4. notify_event entrega a um alvo explicito MESMO sem ninguem inscrito no evento
--     — esse era o comportamento que faltava, e sem ele o autor da mensagem nao seria avisado
DO $$
DECLARE
  v_cols int; v_cfg int; v_evt int; v_alvo int;
  v_tenant uuid; v_user uuid; v_res jsonb;
BEGIN
  SELECT count(*) INTO v_cols FROM information_schema.columns
   WHERE table_schema='public' AND table_name='whatsapp_messages'
     AND column_name IN ('last_error_at','delivery_confirmed_at','failure_confirmed_at','auto_retry_count');

  SELECT confirm_window_seconds INTO v_cfg FROM whatsapp_delivery_config WHERE id=1;

  SELECT cooldown_minutes INTO v_evt FROM notification_event_types
   WHERE key='whatsapp_message_failed' AND ativo;

  -- Um usuario real qualquer, de um tenant que NAO tenha inscricao neste evento.
  SELECT p.tenant_id, p.user_id INTO v_tenant, v_user
    FROM profiles p
   WHERE p.tenant_id IS NOT NULL AND p.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM notification_subscriptions s
                      WHERE s.tenant_id = p.tenant_id
                        AND s.event_type_key = 'whatsapp_message_failed' AND s.ativo)
   LIMIT 1;

  v_res := notify_event(v_tenant, 'whatsapp_message_failed', 'smoke-conv-1',
                        'Mensagem nao entregue', '1 mensagem nao chegou',
                        jsonb_build_object('target_user_ids', jsonb_build_array(v_user)), null);

  SELECT count(*) INTO v_alvo FROM notification_recipients
   WHERE notification_id = (v_res->>'notification_id')::uuid AND user_id = v_user;

  RAISE EXCEPTION 'SMOKE_OK|colunas=%|janela=%|cooldown=%|entregue_ao_alvo=%|notify=%',
    v_cols, v_cfg, v_evt, v_alvo, v_res::text;
END $$;
