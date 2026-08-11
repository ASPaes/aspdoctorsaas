-- Remarcar um treino que está na etapa de retorno devolve o cartão para a etapa inicial.
-- Fora dela, agendar continua sem mover nada (decisão do owner, 11/08).
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/30_noshow_remarcar.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_uid uuid; v_pipe uuid;
  v_st_ini uuid; v_st_ret uuid; v_treino uuid; v_stage uuid;
  v_status public.onb_treino_status;
BEGIN
  SELECT j.id, j.tenant_id INTO v_journey, v_tenant
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s    ON s.id = j.current_stage_id
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f    ON f.id = p.phase_id
   WHERE f.slug = 'implantacao' AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em Implantação em andamento'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_st_ini := public.fn_onb_training_initial_stage(v_journey);
  SELECT pipeline_id INTO v_pipe FROM public.onboarding_stages WHERE id = v_st_ini;
  SELECT id INTO v_st_ret FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND retorno_no_show AND ativo LIMIT 1;
  IF v_st_ret IS NULL THEN RAISE EXCEPTION 'PRE: pipeline sem etapa de retorno marcada'; END IF;

  -- create_onboarding_training RETORNA uuid (não jsonb).
  v_treino := public.create_onboarding_training(
    v_journey, 'Treino remarcado', now() + interval '1 day', v_uid, false, NULL, NULL, false);

  PERFORM public.mark_onboarding_training_no_show(v_treino);
  SELECT current_stage_id INTO v_stage FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_stage <> v_st_ret THEN RAISE EXCEPTION 'PRE: cartão não foi para a etapa de retorno'; END IF;

  -- ── ação: remarcar de dentro da etapa de retorno
  PERFORM public.update_onboarding_training(
    p_training_id := v_treino, p_agendado_para := now() + interval '3 days');

  SELECT current_stage_id, status INTO v_stage, v_status
    FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_stage <> v_st_ini THEN
    RAISE EXCEPTION 'remarcar devia devolver para a etapa inicial, ficou em %', v_stage;
  END IF;
  IF v_status <> 'agendado' THEN RAISE EXCEPTION 'status devia voltar a agendado, veio %', v_status; END IF;

  -- ── fora da etapa de retorno, agendar NÃO move nada
  PERFORM public.update_onboarding_training(
    p_training_id := v_treino, p_agendado_para := now() + interval '4 days');
  SELECT current_stage_id INTO v_stage FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_stage <> v_st_ini THEN RAISE EXCEPTION 'não devia ter movido de novo'; END IF;

  RAISE NOTICE 'OK 30_noshow_remarcar';
END $$;

ROLLBACK;
