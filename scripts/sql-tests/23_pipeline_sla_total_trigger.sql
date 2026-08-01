-- onboarding_pipelines.sla_total_minutos vira derivado: soma das etapas ativas não-pausa.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/23_pipeline_sla_total_trigger.sql
BEGIN;

DO $$
DECLARE
  v_pipe uuid; v_s uuid; v_esperado int; v_lido int; v_div int;
BEGIN
  -- 1. depois da reconciliação inicial, NENHUM pipeline diverge da soma
  SELECT count(*) INTO v_div
    FROM public.onboarding_pipelines p
   WHERE p.sla_total_minutos IS DISTINCT FROM (
           SELECT sum(s.sla_minutos) FROM public.onboarding_stages s
            WHERE s.pipeline_id = p.id AND s.ativo AND NOT COALESCE(s.pausa_sla,false));
  IF v_div > 0 THEN RAISE EXCEPTION 'FALHA 1: % pipeline(s) divergindo da soma', v_div; END IF;

  SELECT p.id INTO v_pipe FROM public.onboarding_pipelines p
   WHERE EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY p.position LIMIT 1;
  SELECT id INTO v_s FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position LIMIT 1;

  -- 2. mudar o SLA de uma etapa recalcula o total
  UPDATE public.onboarding_stages SET sla_minutos = 777 WHERE id = v_s;
  SELECT sum(sla_minutos) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido IS DISTINCT FROM v_esperado THEN RAISE EXCEPTION 'FALHA 2: esperava %, li %', v_esperado, v_lido; END IF;

  -- 3. desativar uma etapa tira ela da soma
  UPDATE public.onboarding_stages SET ativo = false WHERE id = v_s;
  SELECT sum(sla_minutos) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido IS DISTINCT FROM v_esperado THEN RAISE EXCEPTION 'FALHA 3: esperava %, li %', v_esperado, v_lido; END IF;

  -- 4. marcar pausa_sla tira da soma
  --    (comparar contra a soma das OUTRAS etapas — o total do pipeline nunca é só esta)
  UPDATE public.onboarding_stages SET ativo = true, sla_minutos = 999, pausa_sla = true WHERE id = v_s;
  SELECT sum(sla_minutos) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido IS DISTINCT FROM v_esperado THEN
    RAISE EXCEPTION 'FALHA 4: etapa de pausa entrou na soma — esperava %, li %', v_esperado, v_lido;
  END IF;
  IF COALESCE(v_esperado,0) = 0 THEN RAISE EXCEPTION 'FALHA 4b: fixture inútil, pipeline só tem a etapa de pausa'; END IF;

  -- 5. DELETE recalcula
  UPDATE public.onboarding_stages SET pausa_sla = false WHERE id = v_s;
  DELETE FROM public.onboarding_journey_checklist WHERE stage_id = v_s;
  DELETE FROM public.onboarding_stage_checklist WHERE stage_id = v_s;
  DELETE FROM public.onboarding_stage_history WHERE stage_id = v_s;
  UPDATE public.onboarding_journeys SET current_stage_id = NULL WHERE current_stage_id = v_s;
  UPDATE public.onboarding_journeys SET sla_encerrado_stage_id = NULL WHERE sla_encerrado_stage_id = v_s;
  DELETE FROM public.onboarding_stages WHERE id = v_s;
  SELECT sum(sla_minutos) INTO v_esperado FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT COALESCE(pausa_sla,false);
  SELECT sla_total_minutos INTO v_lido FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_lido IS DISTINCT FROM v_esperado THEN RAISE EXCEPTION 'FALHA 5: esperava %, li %', v_esperado, v_lido; END IF;

  RAISE NOTICE 'OK 23_pipeline_sla_total_trigger';
END $$;

ROLLBACK;
