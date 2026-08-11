-- DEM-0269: a saída do Onboarding decide pelo treino agendado.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_saida_onboarding_sem_treino.sql
BEGIN;

-- can_access_tenant_row barra o postgres do psql; aqui o alvo são as regras da
-- função, não a RLS (essa tem teste próprio). Neutralizada só dentro da transação.
CREATE OR REPLACE FUNCTION public.can_access_tenant_row(row_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

DO $$
DECLARE
  v_j        uuid;
  v_tenant   uuid;
  v_ticket   uuid;
  v_final    uuid;
  v_pipe_onb uuid;
  v_res      jsonb;
  v_txt      text;
  v_ts       uuid;
  v_stage    uuid;
  v_cliente  uuid;
  v_qtd      int;
BEGIN
  -- ---- fixture: jornada em Onboarding, parada na etapa final, sem treino ----
  SELECT j.id, j.tenant_id, j.ticket_id, s.pipeline_id
    INTO v_j, v_tenant, v_ticket, v_pipe_onb
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.fase_atual = 'onboarding'
     AND j.situacao NOT IN ('concluido','cancelado')
     AND j.pipeline_implantacao_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_training_sessions t WHERE t.journey_id = j.id)
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: nenhuma jornada em Onboarding sem treino'; END IF;

  SELECT id INTO v_final FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_onb AND ativo AND is_final ORDER BY position DESC LIMIT 1;
  IF v_final IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: pipeline de onboarding sem etapa is_final'; END IF;

  UPDATE public.onboarding_journeys SET current_stage_id = v_final WHERE id = v_j;

  -- 1. helper enxerga "sem treino"
  IF public.fn_onb_tem_treino_vivo(v_j) THEN
    RAISE EXCEPTION 'FALHOU 1: jornada sem treino, mas fn_onb_tem_treino_vivo disse true';
  END IF;

  -- 2. avanço RECUSA sem treino e sem opt-in — o coração da regra
  v_res := public.advance_onboarding_to_implantacao(v_j, false);
  IF COALESCE((v_res->>'ok')::boolean, true) THEN
    RAISE EXCEPTION 'FALHOU 2: avançou sem treino e sem opt-in — %', v_res::text;
  END IF;
  IF v_res->>'reason' <> 'sem_treino' THEN
    RAISE EXCEPTION 'FALHOU 2b: esperava reason=sem_treino, veio %', v_res::text;
  END IF;

  -- 3. a jornada não se mexeu na recusa
  SELECT fase_atual::text INTO v_txt FROM public.onboarding_journeys WHERE id = v_j;
  IF v_txt <> 'onboarding' THEN
    RAISE EXCEPTION 'FALHOU 3: recusa mexeu na jornada, fase virou %', v_txt;
  END IF;

  -- 4. com o opt-in explícito, avança (saída A do diálogo)
  v_res := public.advance_onboarding_to_implantacao(v_j, false, true);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'FALHOU 4: opt-in não avançou — %', v_res::text;
  END IF;
  SELECT fase_atual::text INTO v_txt FROM public.onboarding_journeys WHERE id = v_j;
  IF v_txt <> 'implantacao' THEN
    RAISE EXCEPTION 'FALHOU 4b: esperava implantacao, veio %', v_txt;
  END IF;

  -- 5. o evento diz que foi sem treino — é o que sobra para a auditoria
  SELECT content INTO v_txt FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_fase_implantacao'
   ORDER BY created_at DESC LIMIT 1;
  IF v_txt NOT LIKE '%sem treino agendado%' THEN
    RAISE EXCEPTION 'FALHOU 5: evento sem a marca de "sem treino": %', v_txt;
  END IF;

  -- ---- fixture 2: jornada em Onboarding COM treino ----
  SELECT j.id, j.tenant_id, j.ticket_id, s.pipeline_id INTO v_j, v_tenant, v_ticket, v_pipe_onb
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.fase_atual = 'onboarding'
     AND j.situacao NOT IN ('concluido','cancelado')
     AND j.pipeline_implantacao_id IS NOT NULL
     AND j.id <> v_j
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE 2'; END IF;

  SELECT id INTO v_final FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_onb AND ativo AND is_final ORDER BY position DESC LIMIT 1;
  UPDATE public.onboarding_journeys SET current_stage_id = v_final WHERE id = v_j;

  -- o treino é sempre um sub-ticket do pai; ticket_id é NOT NULL
  SELECT cliente_id INTO v_cliente FROM public.support_tickets WHERE id = v_ticket;
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, origem_criacao,
                                      parent_ticket_id, ticket_code, sub_seq)
  VALUES (v_tenant, v_cliente, 'Treino de teste', 'onboarding', 'onboarding_treino',
          v_ticket, 'TK-TESTE-0001', 1)
  RETURNING id INTO v_stage;

  INSERT INTO public.onboarding_training_sessions (tenant_id, ticket_id, journey_id, titulo, status)
  VALUES (v_tenant, v_stage, v_j, 'Treino de teste', 'agendado') RETURNING id INTO v_ts;

  -- 6. com treino, avança direto — sem opt-in, sem pergunta
  v_res := public.advance_onboarding_to_implantacao(v_j, false);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'FALHOU 6: com treino agendado deveria avançar direto — %', v_res::text;
  END IF;

  -- 7. treino cancelado não conta como treino
  UPDATE public.onboarding_training_sessions SET status = 'cancelado' WHERE id = v_ts;
  IF public.fn_onb_tem_treino_vivo(v_j) THEN
    RAISE EXCEPTION 'FALHOU 7: treino cancelado ainda conta como vivo';
  END IF;

  -- ---- fixture 3: encerrar NO Onboarding (saída B) ----
  SELECT j.id, j.ticket_id, s.pipeline_id INTO v_j, v_ticket, v_pipe_onb
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.fase_atual = 'onboarding'
     AND j.situacao NOT IN ('concluido','cancelado')
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_training_sessions t WHERE t.journey_id = j.id)
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE 3'; END IF;

  v_res := public.journey_go_live(v_j, NULL, 'Cliente já operava o PDV');
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'FALHOU 8: go-live no Onboarding recusou — %', v_res::text;
  END IF;

  -- 9. jornada concluída sem passar pela Implantação
  SELECT situacao::text INTO v_txt FROM public.onboarding_journeys WHERE id = v_j;
  IF v_txt <> 'concluido' THEN
    RAISE EXCEPTION 'FALHOU 9: esperava situacao=concluido, veio %', v_txt;
  END IF;

  -- 10. e sem inventar data de implantação — era dado falso em relatório
  SELECT count(*) INTO v_qtd FROM public.onboarding_journeys
   WHERE id = v_j AND implantacao_concluida_em IS NOT NULL;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 10: encerrou no Onboarding mas gravou implantacao_concluida_em';
  END IF;

  -- 11. o motivo digitado foi parar na Timeline
  SELECT content INTO v_txt FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_concluido'
   ORDER BY created_at DESC LIMIT 1;
  IF v_txt NOT LIKE '%Cliente já operava o PDV%' THEN
    RAISE EXCEPTION 'FALHOU 11: motivo não chegou no evento: %', v_txt;
  END IF;
  IF v_txt NOT LIKE '%sem treinamento%' THEN
    RAISE EXCEPTION 'FALHOU 11b: evento não diz que foi sem treinamento: %', v_txt;
  END IF;

  -- 12. a versão de 2 argumentos saiu do catálogo: com ela viva, uma chamada
  --     antiga casaria com a assinatura sem checagem e furaria a regra
  SELECT count(*) INTO v_qtd FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'advance_onboarding_to_implantacao';
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 12: existem % versões de advance_onboarding_to_implantacao, esperava 1', v_qtd;
  END IF;

  -- 13. conclude_onboarding_journey não pode continuar aberta para anon/PUBLIC
  SELECT count(*) INTO v_qtd FROM information_schema.routine_privileges
   WHERE specific_schema = 'public' AND routine_name = 'conclude_onboarding_journey'
     AND grantee IN ('PUBLIC','anon');
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 13: conclude_onboarding_journey ainda concedida a % grantee(s) público(s)', v_qtd;
  END IF;

  RAISE NOTICE 'OK: 13 asserções passaram';
END $$;

ROLLBACK;
