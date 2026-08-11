-- revert_onboarding_to_onboarding: desfazer a ida para a Implantação sem perder tempo
-- de fase nem deixar Implantação fantasma.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/23_revert_onboarding_to_onboarding.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_tenant_row(row_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

DO $$
DECLARE
  v_j uuid; v_tenant uuid; v_ticket uuid; v_cliente uuid;
  v_pipe_onb uuid; v_final uuid; v_sub uuid; v_ts uuid;
  v_res jsonb; v_txt text; v_qtd int;
  v_onb_ini timestamptz; v_onb_ini_depois timestamptz;
BEGIN
  -- ---- fixture: jornada em Onboarding, etapa final, sem treino ----
  SELECT j.id, j.tenant_id, j.ticket_id, s.pipeline_id
    INTO v_j, v_tenant, v_ticket, v_pipe_onb
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.fase_atual = 'onboarding'
     AND j.situacao NOT IN ('concluido','cancelado')
     AND j.pipeline_implantacao_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_training_sessions t WHERE t.journey_id = j.id)
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE'; END IF;

  SELECT id INTO v_final FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_onb AND ativo AND is_final ORDER BY position DESC LIMIT 1;
  -- Mover a etapa exige mexer nos DOIS lugares. Só trocar current_stage_id cria um
  -- descasamento que não existe em produção — e a função restaura pelo HISTÓRICO,
  -- então a fixture torta faria o teste acusar bug que não há.
  UPDATE public.onboarding_journeys SET current_stage_id = v_final WHERE id = v_j;
  UPDATE public.onboarding_stage_history SET stage_id = v_final
   WHERE journey_id = v_j AND saiu_em IS NULL;

  SELECT iniciada_em INTO v_onb_ini FROM public.onboarding_phase_metrics
   WHERE journey_id = v_j AND fase = 'onboarding';
  IF v_onb_ini IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: jornada sem linha de fase do Onboarding'; END IF;

  -- vai para a Implantação (saída A, sem treino)
  v_res := public.advance_onboarding_to_implantacao(v_j, false, true);
  IF NOT COALESCE((v_res->>'ok')::boolean,false) THEN RAISE EXCEPTION 'SETUP: %', v_res::text; END IF;

  -- 1. desfaz
  v_res := public.revert_onboarding_to_onboarding(v_j);
  IF NOT COALESCE((v_res->>'ok')::boolean,false) THEN RAISE EXCEPTION 'FALHOU 1: %', v_res::text; END IF;

  -- 2. voltou para o Onboarding, na última etapa percorrida
  SELECT fase_atual::text INTO v_txt FROM public.onboarding_journeys WHERE id = v_j;
  IF v_txt <> 'onboarding' THEN RAISE EXCEPTION 'FALHOU 2: fase %', v_txt; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_journeys
   WHERE id = v_j AND current_stage_id = v_final;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 2b: nao voltou para a etapa final do onboarding'; END IF;

  -- 3. NÃO sobrou linha de fase da Implantação (era o bug: ela sobrevivia fechada
  --    em now() e o quadro lia isso como go-live)
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_j AND fase = 'implantacao';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: sobrou linha de fase da Implantacao'; END IF;

  -- 4. a fase do Onboarding voltou a correr E manteve o início original
  --    (era o outro bug: apagava esta linha e o trigger recriava com now())
  SELECT concluida_em, iniciada_em INTO v_txt, v_onb_ini_depois
    FROM public.onboarding_phase_metrics WHERE journey_id = v_j AND fase = 'onboarding';
  IF v_txt IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 4: fase do Onboarding continua fechada'; END IF;
  IF v_onb_ini_depois IS DISTINCT FROM v_onb_ini THEN
    RAISE EXCEPTION 'FALHOU 4b: iniciada_em do Onboarding mudou de % para %', v_onb_ini, v_onb_ini_depois;
  END IF;

  -- 5. o snapshot de SLA da fase foi descartado
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_j AND fase = 'onboarding'
     AND (sla_corrido_min IS NOT NULL OR sla_util_min IS NOT NULL OR pausado_min IS NOT NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: snapshot de SLA sobreviveu ao revert'; END IF;

  -- 6. a etapa reaberta não guarda tempo que não gastou
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_history
   WHERE journey_id = v_j AND saiu_em IS NULL
     AND (duracao_minutos IS NOT NULL OR duracao_util_minutos IS NOT NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 6: etapa aberta com duracao preenchida'; END IF;

  -- 7. nenhum histórico da Implantação sobrou
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_history sh
    JOIN public.onboarding_stages s ON s.id = sh.stage_id
    JOIN public.onboarding_journeys j ON j.id = sh.journey_id
   WHERE sh.journey_id = v_j AND s.pipeline_id = j.pipeline_implantacao_id;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 7: sobrou historico da Implantacao'; END IF;

  -- 8. as datas de fase foram limpas
  SELECT count(*) INTO v_qtd FROM public.onboarding_journeys
   WHERE id = v_j AND (onboarding_concluido_em IS NOT NULL OR implantacao_iniciada_em IS NOT NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 8: datas de fase sobreviveram'; END IF;

  -- 9. rastro na Timeline
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_fase_revertida';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 9: sem evento de reversao'; END IF;

  -- 10. desfazer duas vezes não faz besteira
  v_res := public.revert_onboarding_to_onboarding(v_j);
  IF COALESCE((v_res->>'ok')::boolean,true) OR v_res->>'reason' <> 'nao_em_implantacao' THEN
    RAISE EXCEPTION 'FALHOU 10: segundo revert deveria recusar — %', v_res::text;
  END IF;

  -- ---- 11. com treino vivo, recusa ----
  v_res := public.advance_onboarding_to_implantacao(v_j, false, true);
  IF NOT COALESCE((v_res->>'ok')::boolean,false) THEN RAISE EXCEPTION 'SETUP 11: %', v_res::text; END IF;

  SELECT cliente_id INTO v_cliente FROM public.support_tickets WHERE id = v_ticket;
  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, origem_criacao,
                                      parent_ticket_id, ticket_code, sub_seq)
  VALUES (v_tenant, v_cliente, 'Treino de teste', 'onboarding', 'onboarding_treino',
          v_ticket, 'TK-TESTE-0002', 1) RETURNING id INTO v_sub;
  INSERT INTO public.onboarding_training_sessions (tenant_id, ticket_id, journey_id, titulo, status)
  VALUES (v_tenant, v_sub, v_j, 'Treino de teste', 'agendado') RETURNING id INTO v_ts;

  v_res := public.revert_onboarding_to_onboarding(v_j);
  IF COALESCE((v_res->>'ok')::boolean,true) OR v_res->>'reason' <> 'tem_treino' THEN
    RAISE EXCEPTION 'FALHOU 11: com treino vivo deveria recusar — %', v_res::text;
  END IF;

  -- 12. cancelar o ÚLTIMO treino desfaz a ida sozinho.
  --     Quem faz isso é o trigger trg_onb_training_cancel_undo, e é o único chamador
  --     desta função no banco — não existe botão. Ou seja: os defeitos que este
  --     arquivo cobre rodavam em produção sem ninguém pedir.
  UPDATE public.onboarding_training_sessions SET status = 'cancelado' WHERE id = v_ts;
  SELECT fase_atual::text INTO v_txt FROM public.onboarding_journeys WHERE id = v_j;
  IF v_txt <> 'onboarding' THEN
    RAISE EXCEPTION 'FALHOU 12: cancelar o ultimo treino deveria devolver ao Onboarding, veio %', v_txt;
  END IF;

  -- 13. e o revert automático respeita as mesmas invariantes do manual
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_j AND fase = 'implantacao';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 13: revert automatico deixou Implantacao fantasma'; END IF;
  SELECT iniciada_em INTO v_onb_ini_depois FROM public.onboarding_phase_metrics
   WHERE journey_id = v_j AND fase = 'onboarding';
  IF v_onb_ini_depois IS DISTINCT FROM v_onb_ini THEN
    RAISE EXCEPTION 'FALHOU 13b: revert automatico moveu o inicio da fase de % para %', v_onb_ini, v_onb_ini_depois;
  END IF;

  RAISE NOTICE 'OK: 13 asserções passaram';
END $$;

ROLLBACK;
