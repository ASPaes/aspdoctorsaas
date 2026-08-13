-- RPC de escrita do onboarding não pode ser chamada sem login (12/08).
--
-- Medido em 12/08: com role `anon` e só o UUID da jornada, cancel_onboarding_journey
-- devolveu {"ok": true} e cancelou uma jornada de verdade.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/34_onboarding_rpcs_fora_do_anon.sql
BEGIN;

-- 1. nenhuma das 8 continua ao alcance do anon
DO $$
DECLARE v_abertas text;
BEGIN
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_abertas
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('cancel_onboarding_journey','create_onboarding_journey','move_onboarding_stage',
                       'pause_onboarding','resume_onboarding','reopen_onboarding_journey',
                       'return_to_vendor','resolve_vendor_return')
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  IF v_abertas IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 1: ainda executáveis por anon: %', v_abertas;
  END IF;
  RAISE NOTICE 'OK 34 parte 1: nenhuma RPC de escrita ao alcance do anon';
END $$;

-- 2. quem precisa continua enxergando: o app (authenticated) e as edge functions
DO $$
DECLARE v_faltando text;
BEGIN
  SELECT string_agg(p.proname || ' (' || r.rolname || ')', ', ') INTO v_faltando
    FROM pg_proc p
    CROSS JOIN (SELECT unnest(ARRAY['authenticated','service_role']) AS rolname) r
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('cancel_onboarding_journey','create_onboarding_journey','move_onboarding_stage',
                       'pause_onboarding','resume_onboarding','reopen_onboarding_journey',
                       'return_to_vendor','resolve_vendor_return')
     AND NOT has_function_privilege(r.rolname, p.oid, 'EXECUTE');
  IF v_faltando IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 2: revoke levou junto quem precisava: %', v_faltando;
  END IF;
  RAISE NOTICE 'OK 34 parte 2: authenticated e service_role intactos';
END $$;

-- 3. a prova de fogo: anon tentando cancelar uma jornada de verdade
DO $$
DECLARE v_j uuid; v_res jsonb; v_erro text;
BEGIN
  SELECT id INTO v_j FROM public.onboarding_journeys WHERE situacao = 'em_andamento' LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento'; END IF;

  SET LOCAL role anon;
  BEGIN
    v_res := public.cancel_onboarding_journey(v_j, 'teste anon');
    v_erro := NULL;
  EXCEPTION WHEN insufficient_privilege THEN
    v_erro := 'barrado';
  END;
  RESET role;

  IF v_erro IS NULL THEN
    RAISE EXCEPTION 'FALHA 3: anon cancelou a jornada sem login: %', v_res;
  END IF;
  RAISE NOTICE 'OK 34 parte 3: anon barrado no cancelamento';
END $$;

ROLLBACK;
