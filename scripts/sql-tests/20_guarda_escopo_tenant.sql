-- Asserções da guarda de escopo de tenant (31/07).
-- Um usuário logado não pode ler dado de outra empresa passando o tenant_id dela na RPC;
-- edge function, cron, super admin e o uso normal do próprio tenant continuam funcionando.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/20_guarda_escopo_tenant.sql
BEGIN;

DO $$
DECLARE
  v_a uuid; v_b uuid; v_nome_a text; v_nome_b text;
  v_uid_a uuid; v_uid_super uuid;
  v_n int; v_x jsonb; v_barrou boolean; v_qtd int;
BEGIN
  -- dois tenants distintos, cada um com mensagens, e um operador comum no primeiro
  SELECT t.id, t.nome INTO v_a, v_nome_a
    FROM public.tenants t
   WHERE EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.tenant_id = t.id AND coalesce(p.is_super_admin,false) = false)
     AND EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.tenant_id = t.id)
   ORDER BY t.nome LIMIT 1;
  SELECT t.id, t.nome INTO v_b, v_nome_b
    FROM public.tenants t
   WHERE t.id <> v_a
     AND EXISTS (SELECT 1 FROM public.whatsapp_messages m WHERE m.tenant_id = t.id)
   ORDER BY t.nome LIMIT 1;
  IF v_a IS NULL OR v_b IS NULL THEN RAISE EXCEPTION 'PRE: preciso de 2 tenants com mensagens'; END IF;

  SELECT user_id INTO v_uid_a FROM public.profiles
   WHERE tenant_id = v_a AND coalesce(is_super_admin,false) = false LIMIT 1;
  SELECT user_id INTO v_uid_super FROM public.profiles WHERE coalesce(is_super_admin,false) LIMIT 1;
  IF v_uid_super IS NULL THEN RAISE EXCEPTION 'PRE: nenhum super admin na base'; END IF;

  -- ── 1. a guarda existe e está fechada para o cliente
  SELECT count(*) INTO v_qtd FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('assert_tenant_scope','assert_tenant_scope_strict')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 1: guarda chamável por authenticated'; END IF;

  -- ── 2. cobertura: nenhuma RPC SECURITY DEFINER com tenant segue sem checagem,
  --      fora os 7 helpers de calendário/lookup deixados de fora conscientemente
  SELECT count(*) INTO v_qtd FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
     AND pg_get_function_identity_arguments(p.oid) ~* 'tenant'
     AND NOT (p.prosrc ~* 'can_access_tenant_row|is_super_admin|current_tenant_id|auth\.uid|assert_tenant_scope')
     AND p.proname NOT IN ('fn_add_business_days','fn_business_due_at','fn_is_business_hours',
                           'segundos_uteis','fn_onb_util_min','fn_onboarding_phase_id',
                           'fn_onboarding_role_id');
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2: % RPC(s) ainda sem guarda', v_qtd; END IF;

  -- ── 3. operador comum do tenant A tentando ler o tenant B
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  v_barrou := false;
  BEGIN SELECT count(*) INTO v_n FROM public.search_messages_by_content(v_b,'a'::text,3650,NULL::uuid,50);
  EXCEPTION WHEN insufficient_privilege THEN v_barrou := true; END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 3a: leu % mensagens de outro tenant', v_n; END IF;

  v_barrou := false;
  BEGIN v_x := public.get_today_metrics(v_b);
  EXCEPTION WHEN insufficient_privilege THEN v_barrou := true; END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 3b: leu métricas de outro tenant'; END IF;

  v_barrou := false;
  BEGIN v_x := public.get_attendance_metrics(v_b, now()-interval '7 days', now(), NULL, NULL, NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_barrou := true; END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 3c: leu atendimento de outro tenant'; END IF;

  -- ── 4. NULL (= todos os tenants) não é atalho para quem não é super admin
  v_barrou := false;
  BEGIN v_x := public.get_today_metrics(NULL::uuid);
  EXCEPTION WHEN insufficient_privilege THEN v_barrou := true; END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 4a: viu a plataforma inteira com NULL'; END IF;

  v_barrou := false;
  BEGIN v_x := public.get_ai_cost_metrics(NULL::uuid, current_date-7, current_date);
  EXCEPTION WHEN insufficient_privilege THEN v_barrou := true; END;
  IF NOT v_barrou THEN RAISE EXCEPTION 'FALHOU 4b: viu custo de IA de todos com NULL'; END IF;

  -- ── 5. o uso legítimo do próprio tenant não pode ter quebrado
  BEGIN
    SELECT count(*) INTO v_n FROM public.search_messages_by_content(v_a,'a'::text,3650,NULL::uuid,50);
    v_x := public.get_today_metrics(v_a);
    v_x := public.get_attendance_metrics(v_a, now()-interval '7 days', now(), NULL, NULL, NULL);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FALHOU 5: quebrou o uso do próprio tenant (%)', SQLERRM;
  END;
  RESET role;

  -- ── 6. super admin continua enxergando a plataforma e simulando tenant
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid_super::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  BEGIN
    v_x := public.get_today_metrics(NULL::uuid);
    v_x := public.get_today_metrics(v_b);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FALHOU 6: super admin foi barrado (%)', SQLERRM;
  END;
  RESET role;

  -- ── 7. edge function (service_role) passa em qualquer tenant
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SET LOCAL role service_role;
  BEGIN
    v_x := public.get_today_metrics(v_b);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FALHOU 7: edge function foi barrada (%)', SQLERRM;
  END;
  RESET role;

  -- ── 8. cron/trigger (sem role de PostgREST) passa
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.assert_tenant_scope(v_b);
    PERFORM public.assert_tenant_scope_strict(NULL::uuid);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'FALHOU 8: chamada interna foi barrada (%)', SQLERRM;
  END;

  RAISE NOTICE 'OK — 8 asserções passaram (% tentou ler %)', v_nome_a, v_nome_b;
END $$;

ROLLBACK;
