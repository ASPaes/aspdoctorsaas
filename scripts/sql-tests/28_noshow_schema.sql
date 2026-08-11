-- Schema do no-show (11/08): flag da etapa de retorno e contadores do treino.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/28_noshow_schema.sql
BEGIN;

DO $$
DECLARE
  v_pipe uuid; v_a uuid; v_b uuid;
BEGIN
  -- ── colunas existem, com os defaults certos
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_stages' AND column_name='retorno_no_show';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALTA onboarding_stages.retorno_no_show'; END IF;

  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_training_sessions'
     AND column_name='no_shows' AND column_default = '0';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALTA onboarding_training_sessions.no_shows com default 0'; END IF;

  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_training_sessions'
     AND column_name='ultimo_no_show_em';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALTA onboarding_training_sessions.ultimo_no_show_em'; END IF;

  -- ── uma etapa de retorno por pipeline
  SELECT s.pipeline_id INTO v_pipe
    FROM public.onboarding_stages s
   GROUP BY s.pipeline_id HAVING count(*) >= 2 LIMIT 1;
  IF v_pipe IS NULL THEN RAISE EXCEPTION 'PRE: nenhum pipeline com 2+ etapas'; END IF;

  SELECT id INTO v_a FROM public.onboarding_stages WHERE pipeline_id = v_pipe ORDER BY position LIMIT 1;
  SELECT id INTO v_b FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND id <> v_a ORDER BY position LIMIT 1;

  UPDATE public.onboarding_stages SET retorno_no_show = false WHERE pipeline_id = v_pipe;
  UPDATE public.onboarding_stages SET retorno_no_show = true  WHERE id = v_a;
  BEGIN
    UPDATE public.onboarding_stages SET retorno_no_show = true WHERE id = v_b;
    RAISE EXCEPTION 'DEVIA TER BARRADO a segunda etapa de retorno do mesmo pipeline';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- esperado
  END;

  -- ── backfill do contador
  PERFORM 1 FROM public.onboarding_training_sessions WHERE no_show = true AND no_shows = 0;
  IF FOUND THEN RAISE EXCEPTION 'BACKFILL faltou: existe no_show=true com no_shows=0'; END IF;

  RAISE NOTICE 'OK 28_noshow_schema';
END $$;

ROLLBACK;
