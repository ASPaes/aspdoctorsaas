-- No-show (11/08): a RPC grava a falta, limpa a agenda, volta o status e move o cartão.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/29_noshow_rpc.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_uid uuid; v_pipe uuid;
  v_st_ini uuid; v_st_ret uuid; v_treino uuid; v_ticket uuid; v_res jsonb;
  v_status public.onb_treino_status; v_ag timestamptz; v_ult timestamptz;
  v_stage uuid; v_n int; v_tent int; v_evt text;
BEGIN
  -- ── fixture: jornada real em Implantação, para não esbarrar em constraint de dado sintético
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
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin/head no tenant'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_st_ini := public.fn_onb_training_initial_stage(v_journey);
  SELECT pipeline_id INTO v_pipe FROM public.onboarding_stages WHERE id = v_st_ini;
  SELECT id INTO v_st_ret FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND retorno_no_show AND ativo LIMIT 1;
  IF v_st_ret IS NULL THEN RAISE EXCEPTION 'PRE: pipeline sem etapa de retorno marcada'; END IF;

  -- create_onboarding_training RETORNA uuid (não jsonb).
  v_treino := public.create_onboarding_training(
    v_journey, 'Treino de teste no-show', now() + interval '1 day', v_uid, false, NULL, NULL, false);
  IF v_treino IS NULL THEN RAISE EXCEPTION 'PRE: create_onboarding_training não devolveu o treino'; END IF;
  SELECT ticket_id INTO v_ticket FROM public.onboarding_training_sessions WHERE id = v_treino;

  -- ── ação
  v_res := public.mark_onboarding_training_no_show(v_treino);
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'RPC recusou: %', v_res; END IF;

  SELECT status, agendado_para, ultimo_no_show_em, current_stage_id, no_shows, tentativas
    INTO v_status, v_ag, v_ult, v_stage, v_n, v_tent
    FROM public.onboarding_training_sessions WHERE id = v_treino;

  IF v_status <> 'previsto' THEN RAISE EXCEPTION 'status devia voltar a previsto, veio %', v_status; END IF;
  IF v_ag IS NOT NULL THEN RAISE EXCEPTION 'agendado_para devia ficar NULL'; END IF;
  IF v_ult IS NULL THEN RAISE EXCEPTION 'ultimo_no_show_em devia guardar a data que furou'; END IF;
  IF v_stage <> v_st_ret THEN RAISE EXCEPTION 'cartão devia estar na etapa de retorno'; END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'no_shows devia ser 1, veio %', v_n; END IF;
  IF v_tent <> 0 THEN RAISE EXCEPTION 'tentativas NÃO deve subir no no-show, veio %', v_tent; END IF;

  -- ── a falta aparece na Timeline com o rótulo certo, não como "previsto"
  SELECT content INTO v_evt FROM public.support_ticket_events
   WHERE origem_sub_ticket_id = v_ticket AND event_type = 'onboarding_treino_status'
   ORDER BY created_at DESC LIMIT 1;
  IF v_evt IS NULL OR v_evt NOT LIKE '%no-show%' THEN
    RAISE EXCEPTION 'Timeline devia registrar no-show, veio: %', COALESCE(v_evt, '<nada>');
  END IF;

  -- ── segunda falta acumula
  UPDATE public.onboarding_training_sessions
     SET status = 'agendado', agendado_para = now() + interval '2 days' WHERE id = v_treino;
  PERFORM public.mark_onboarding_training_no_show(v_treino);
  SELECT no_shows INTO v_n FROM public.onboarding_training_sessions WHERE id = v_treino;
  IF v_n <> 2 THEN RAISE EXCEPTION 'segunda falta devia somar 2, veio %', v_n; END IF;

  -- ── treino realizado não aceita no-show
  UPDATE public.onboarding_training_sessions SET status = 'realizado' WHERE id = v_treino;
  v_res := public.mark_onboarding_training_no_show(v_treino);
  IF (v_res->>'reason') <> 'treino_realizado' THEN
    RAISE EXCEPTION 'devia recusar treino realizado, veio %', v_res;
  END IF;

  -- ── treino cancelado idem
  UPDATE public.onboarding_training_sessions SET status = 'cancelado' WHERE id = v_treino;
  v_res := public.mark_onboarding_training_no_show(v_treino);
  IF (v_res->>'reason') <> 'treino_cancelado' THEN
    RAISE EXCEPTION 'devia recusar treino cancelado, veio %', v_res;
  END IF;

  RAISE NOTICE 'OK 29_noshow_rpc';
END $$;

ROLLBACK;
