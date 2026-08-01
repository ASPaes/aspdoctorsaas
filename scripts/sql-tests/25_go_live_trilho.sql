-- fn_journey_go_live passa a derivar do trilho, não mais do tipo de demanda.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/25_go_live_trilho.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_prod bigint; v_d date; v_dias int; v_min int; v_n int;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  SELECT p.produto_id INTO v_prod FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.produto_id IS NOT NULL ORDER BY p.position LIMIT 1;

  -- 1. existe UMA fn_journey_go_live, com a assinatura nova
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE proname = 'fn_journey_go_live' AND pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 1: esperava 1 fn_journey_go_live, achei %', v_n; END IF;

  -- compara por TIPO, não pela string com nomes de parâmetro
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'fn_journey_go_live' AND pronamespace = 'public'::regnamespace
       AND array_to_string(ARRAY(
             SELECT format_type(t, NULL) FROM unnest(proargtypes) AS t), ', ')
           = 'uuid, timestamp with time zone, bigint, uuid'
  ) THEN
    RAISE EXCEPTION 'FALHA 1b: assinatura errada — é %', (
      SELECT array_to_string(ARRAY(SELECT format_type(t, NULL) FROM unnest(proargtypes) AS t), ', ')
        FROM pg_proc WHERE proname='fn_journey_go_live' AND pronamespace='public'::regnamespace);
  END IF;

  -- 2. devolve data e usa base 480 (1 dia útil = 8h)
  v_min := public.fn_onb_trilho_sla_min(v_tenant, v_prod);
  v_dias := CEIL(v_min::numeric / 480.0)::int;
  v_d := public.fn_journey_go_live(v_tenant, now(), v_prod, NULL);
  IF v_d IS NULL THEN RAISE EXCEPTION 'FALHA 2a: go-live veio NULL com trilho de % min', v_min; END IF;
  IF v_d <> public.fn_add_business_days((now() AT TIME ZONE 'America/Sao_Paulo')::date, v_dias, v_tenant, NULL) THEN
    RAISE EXCEPTION 'FALHA 2b: go-live não bate com % dias úteis', v_dias;
  END IF;

  -- 3. NÃO depende mais do tipo de demanda: zerar todos e o go-live continua igual
  UPDATE public.onboarding_demand_types SET sla_total_minutos = 0 WHERE tenant_id = v_tenant;
  IF public.fn_journey_go_live(v_tenant, now(), v_prod, NULL) <> v_d THEN
    RAISE EXCEPTION 'FALHA 3: go-live ainda depende do tipo de demanda';
  END IF;

  -- 4. tenant sem trilho configurado devolve NULL, não uma data errada
  IF public.fn_journey_go_live('00000000-0000-0000-0000-000000000000', now(), NULL, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 4: tenant sem trilho devolveu data';
  END IF;

  RAISE NOTICE 'OK 25_go_live_trilho — % min = % dias úteis, go-live %', v_min, v_dias, v_d;
END $$;

ROLLBACK;
