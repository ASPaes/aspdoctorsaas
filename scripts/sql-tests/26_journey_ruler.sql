-- get_journey_ruler: uma linha por ETAPA (não por passagem), backfill do histórico antigo.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/26_journey_ruler.sql
BEGIN;

DO $$
DECLARE
  v_j uuid; v_res jsonb; v_dup int; v_pass int; v_pend int;
  v_soma_regua int; v_soma_hist int; v_fora int;
BEGIN
  -- 1. o backfill zerou as linhas fechadas sem duração útil
  SELECT count(*) INTO v_pend FROM public.onboarding_stage_history
   WHERE saiu_em IS NOT NULL AND duracao_util_minutos IS NULL;
  IF v_pend > 0 THEN RAISE EXCEPTION 'FALHA 1: % linhas fechadas sem duracao_util', v_pend; END IF;

  -- 2. jornada com revisita: a etapa aparece UMA vez, com passagens > 1
  SELECT h.journey_id INTO v_j
    FROM public.onboarding_stage_history h
   GROUP BY h.journey_id, h.stage_id
  HAVING count(*) > 1
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE 2: nenhuma jornada com passagem repetida'; END IF;

  v_res := public.get_journey_ruler(v_j);
  IF v_res IS NULL OR jsonb_typeof(v_res) <> 'array' THEN
    RAISE EXCEPTION 'FALHA 2a: get_journey_ruler não devolveu array';
  END IF;

  SELECT COALESCE(count(*),0) INTO v_dup FROM (
    SELECT e->>'stage_id' AS sid FROM jsonb_array_elements(v_res) e
     GROUP BY 1 HAVING count(*) > 1
  ) x;
  IF v_dup > 0 THEN RAISE EXCEPTION 'FALHA 2b: % etapa(s) repetida(s) na régua', v_dup; END IF;

  SELECT max((e->>'passagens')::int) INTO v_pass FROM jsonb_array_elements(v_res) e;
  IF COALESCE(v_pass,0) < 2 THEN RAISE EXCEPTION 'FALHA 2c: revisita não foi contada (max %)', v_pass; END IF;

  -- 3. a soma do real da régua bate com a soma do histórico útil FECHADO da jornada
  --    (etapa aberta é calculada ao vivo, por isso fica fora da comparação)
  SELECT COALESCE(sum((e->>'real_min')::int),0) INTO v_soma_regua
    FROM jsonb_array_elements(v_res) e WHERE (e->>'aberta')::boolean = false;
  SELECT COALESCE(sum(COALESCE(h.duracao_util_minutos,0)),0) INTO v_soma_hist
    FROM public.onboarding_stage_history h
   WHERE h.journey_id = v_j AND h.saiu_em IS NOT NULL
     AND h.stage_id IN (SELECT (e->>'stage_id')::uuid FROM jsonb_array_elements(v_res) e
                         WHERE (e->>'aberta')::boolean = false);
  IF v_soma_regua <> v_soma_hist THEN
    RAISE EXCEPTION 'FALHA 3: régua soma %, histórico soma %', v_soma_regua, v_soma_hist;
  END IF;

  -- 4. ordenada pelo trilho
  IF EXISTS (
    SELECT 1 FROM (
      SELECT (e->>'ordem')::int AS o, row_number() OVER () AS r FROM jsonb_array_elements(v_res) e
    ) x JOIN (
      SELECT (e->>'ordem')::int AS o, row_number() OVER () AS r FROM jsonb_array_elements(v_res) e
    ) y ON y.r = x.r + 1 WHERE y.o < x.o
  ) THEN
    RAISE EXCEPTION 'FALHA 4: régua fora da ordem do trilho';
  END IF;

  -- 5. marcar encerra_sla numa etapa do meio joga as posteriores para fora da janela
  UPDATE public.onboarding_stages s SET encerra_sla = true
   WHERE s.id = (SELECT (e->>'stage_id')::uuid FROM jsonb_array_elements(v_res) e
                  ORDER BY (e->>'ordem')::int LIMIT 1 OFFSET 1);
  v_res := public.get_journey_ruler(v_j);
  SELECT count(*) INTO v_fora FROM jsonb_array_elements(v_res) e
   WHERE (e->>'fora_janela')::boolean;
  IF v_fora = 0 THEN RAISE EXCEPTION 'FALHA 5: nenhuma etapa marcada como fora da janela'; END IF;

  -- 6. jornada inexistente devolve NULL, não erro
  IF public.get_journey_ruler('00000000-0000-0000-0000-000000000000') IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 6: jornada inexistente não devolveu NULL';
  END IF;

  RAISE NOTICE 'OK 26_journey_ruler — % etapas, max % passagens, % fora da janela',
    jsonb_array_length(v_res), v_pass, v_fora;
END $$;

ROLLBACK;
