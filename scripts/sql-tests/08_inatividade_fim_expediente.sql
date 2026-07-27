-- Antecipação de aviso/encerramento quando o prazo de inatividade extrapola o expediente.
-- Usa um atendimento REAL do banco local (fixture sintética esbarra em constraint/trigger)
-- dentro de BEGIN/ROLLBACK, sem deixar rastro. Assere INVARIANTES, nunca números absolutos.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/08_inatividade_fim_expediente.sql
BEGIN;

DO $$
DECLARE
  v_qtd    int;
  v_att    uuid;
  v_tenant uuid;
  v_agenda timestamptz;
  v_eod    timestamptz;
  v_aviso  timestamptz;
BEGIN
  -- ========== 1. estrutura ==========
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_name = 'support_attendances' AND column_name = 'inactivity_eod_close_at';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1: support_attendances.inactivity_eod_close_at não existe'; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_name = 'configuracoes'
     AND column_name IN ('support_inactivity_eod_enabled',
                         'support_inactivity_eod_warning_template',
                         'support_inactivity_eod_close_template');
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 2: esperava 3 colunas de config do fim de expediente, achei %', v_qtd; END IF;

  -- O recurso nasce ligado; desligar é decisão do tenant.
  SELECT count(*) INTO v_qtd FROM configuracoes WHERE support_inactivity_eod_enabled IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % tenants com support_inactivity_eod_enabled NULL', v_qtd; END IF;

  -- ========== 2. contrato da RPC ==========
  SELECT count(*) INTO v_qtd
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace,
    LATERAL unnest(p.proargnames) AS arg(nome)
   WHERE n.nspname = 'public' AND p.proname = 'get_inactive_attendances_to_process'
     AND arg.nome IN ('inactivity_eod_close_at', 'eod_enabled');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 4: RPC não devolve as colunas de fim de expediente (achei %)', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_name = 'get_inactive_attendances_to_process' AND grantee = 'authenticated';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 5: authenticated perdeu o GRANT na RPC (DROP+CREATE apaga grants)'; END IF;

  -- ========== 3. atendimento real para os testes de trigger ==========
  SELECT a.id, a.tenant_id INTO v_att, v_tenant
    FROM support_attendances a
    JOIN whatsapp_conversations conv ON conv.id = a.conversation_id
   WHERE a.status = 'in_progress' AND a.is_group = false
   LIMIT 1;
  IF v_att IS NULL THEN RAISE EXCEPTION 'FALHOU 6: banco local sem atendimento in_progress para testar'; END IF;

  v_agenda := now() + interval '2 hours';

  -- ========== 4. o motor grava o agendamento sem ser apagado por si mesmo ==========
  UPDATE support_attendances
     SET inactivity_eod_close_at = v_agenda, inactivity_warning_sent_at = now()
   WHERE id = v_att;

  SELECT inactivity_eod_close_at INTO v_eod FROM support_attendances WHERE id = v_att;
  IF v_eod IS NULL THEN
    RAISE EXCEPTION 'FALHOU 7: trigger apagou o agendamento na própria gravação do motor';
  END IF;

  -- ========== 5. mensagem NOVA do cliente cancela aviso e agendamento ==========
  UPDATE support_attendances
     SET last_customer_message_at = now()
   WHERE id = v_att;

  SELECT inactivity_eod_close_at, inactivity_warning_sent_at INTO v_eod, v_aviso
    FROM support_attendances WHERE id = v_att;
  IF v_eod IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 8: mensagem do cliente não cancelou o encerramento agendado (%)', v_eod;
  END IF;
  IF v_aviso IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 9: mensagem do cliente não limpou o aviso de inatividade';
  END IF;

  -- ========== 6. mensagem do OPERADOR também cancela ==========
  UPDATE support_attendances
     SET inactivity_eod_close_at = v_agenda, inactivity_warning_sent_at = now()
   WHERE id = v_att;
  UPDATE support_attendances
     SET last_operator_message_at = now()
   WHERE id = v_att;

  SELECT inactivity_eod_close_at INTO v_eod FROM support_attendances WHERE id = v_att;
  IF v_eod IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 10: mensagem do operador não cancelou o encerramento agendado';
  END IF;

  -- ========== 7. update sem mensagem nova NÃO cancela ==========
  UPDATE support_attendances SET inactivity_eod_close_at = v_agenda WHERE id = v_att;
  UPDATE support_attendances SET updated_at = now() WHERE id = v_att;

  SELECT inactivity_eod_close_at INTO v_eod FROM support_attendances WHERE id = v_att;
  IF v_eod IS NULL THEN
    RAISE EXCEPTION 'FALHOU 11: update sem mensagem nova cancelou o agendamento indevidamente';
  END IF;

  -- ========== 8. eod_enabled acompanha a config do tenant ==========
  -- Sem horário comercial configurado não existe "fim de expediente" para antecipar.
  SELECT count(*) INTO v_qtd
    FROM get_inactive_attendances_to_process(500) q
    JOIN configuracoes c ON c.tenant_id = q.tenant_id
   WHERE q.eod_enabled AND NOT COALESCE(c.business_hours_enabled, false);
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 12: % linhas com eod_enabled sem horário comercial ligado', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM get_inactive_attendances_to_process(500) q
    JOIN configuracoes c ON c.tenant_id = q.tenant_id
   WHERE q.eod_enabled AND NOT COALESCE(c.support_inactivity_eod_enabled, true);
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 13: % linhas com eod_enabled em tenant com o recurso desligado', v_qtd;
  END IF;

  -- ========== 9. a fila não devolve quem está fora do escopo do motor ==========
  -- Bola com o agente, hold manual e agendamento futuro continuam de fora.
  SELECT count(*) INTO v_qtd
    FROM get_inactive_attendances_to_process(500) q
    JOIN support_attendances a ON a.id = q.id
   WHERE a.awaiting_agent_since IS NOT NULL
      OR COALESCE(a.inactivity_hold, false)
      OR a.status <> 'in_progress'
      OR a.is_group;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 14: % linhas fora do escopo do motor vazaram para a fila', v_qtd;
  END IF;

  -- ========== 10. vencidos vêm antes dos candidatos ==========
  WITH ordenado AS (
    SELECT (needs_warn OR needs_close OR (inactivity_eod_close_at IS NOT NULL AND inactivity_eod_close_at <= now())) AS vencido,
           row_number() OVER () AS pos
      FROM get_inactive_attendances_to_process(500)
  )
  SELECT count(*) INTO v_qtd
    FROM ordenado a JOIN ordenado b ON b.pos > a.pos
   WHERE NOT a.vencido AND b.vencido;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 15: candidato apareceu antes de vencido na fila (% pares fora de ordem)', v_qtd;
  END IF;

  RAISE NOTICE 'OK: 15 asserções passaram (fim de expediente).';
END $$;

ROLLBACK;
