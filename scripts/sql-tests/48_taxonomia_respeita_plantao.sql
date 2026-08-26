-- A aba Tickets ignorava o filtro "Só plantão" em silêncio: get_atendimento_taxonomia
-- não tinha p_plantao e devolvia o período inteiro. O usuário via 1.264 x 231 achando
-- que era o recorte de plantão. Este teste é a guarda.
--
-- Assere INVARIANTES, nunca números absolutos: o banco local está congelado.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/48_taxonomia_respeita_plantao.sql
BEGIN;

DO $$
DECLARE
  v_uid    uuid;
  v_tenant uuid;
  v_from   timestamptz := now() - interval '365 days';
  v_to     timestamptz := now();
  v_todos  jsonb;
  v_pl     jsonb;
  v_co     jsonb;
  v_erro   boolean := false;
BEGIN
  -- Fixture: um tenant que realmente tenha ticket dos dois tipos no período.
  SELECT st.tenant_id INTO v_tenant
  FROM support_tickets st
  WHERE st.deleted_at IS NULL AND st.aberto_em >= v_from
  GROUP BY st.tenant_id
  HAVING count(*) FILTER (WHERE st.tipo_horario = 'plantao')   > 0
     AND count(*) FILTER (WHERE st.tipo_horario = 'comercial') > 0
  ORDER BY count(*) DESC
  LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: nenhum tenant com ticket comercial E plantao no período';
  END IF;

  SELECT p.user_id INTO v_uid
  FROM profiles p WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FIXTURE: tenant sem profile'; END IF;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  v_todos := public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  v_pl    := public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'plantao');
  v_co    := public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
               NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'comercial');

  -- 1. sob "só plantão" nenhuma barra comercial sobra, e vice-versa
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_pl->'por_horario') e
             WHERE e->>'tipo' = 'comercial') THEN
    RAISE EXCEPTION 'FALHOU: filtro plantao trouxe linha comercial em por_horario';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_co->'por_horario') e
             WHERE e->>'tipo' = 'plantao') THEN
    RAISE EXCEPTION 'FALHOU: filtro comercial trouxe linha plantao em por_horario';
  END IF;

  -- 2. o total bate com a barra que sobrou
  IF (v_pl->>'total')::int <> COALESCE((
        SELECT (e->>'qtd')::int FROM jsonb_array_elements(v_pl->'por_horario') e
        WHERE e->>'tipo' = 'plantao'), 0) THEN
    RAISE EXCEPTION 'FALHOU: total do recorte plantao não bate com por_horario';
  END IF;

  -- 3. o filtro PARTICIONA: não perde nem duplica ticket
  IF (v_pl->>'total')::int + (v_co->>'total')::int <> (v_todos->>'total')::int THEN
    RAISE EXCEPTION 'FALHOU: plantao(%) + comercial(%) <> todos(%)',
      v_pl->>'total', v_co->>'total', v_todos->>'total';
  END IF;

  -- 4. parâmetro inválido é recusado, não ignorado
  BEGIN
    PERFORM public.get_atendimento_taxonomia(v_tenant, v_from, v_to,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'xpto');
    v_erro := false;
  EXCEPTION WHEN OTHERS THEN
    v_erro := true;
  END;
  IF NOT v_erro THEN
    RAISE EXCEPTION 'FALHOU: p_plantao inválido passou sem erro';
  END IF;

  RAISE NOTICE 'OK: task 9';
END $$;

ROLLBACK;
