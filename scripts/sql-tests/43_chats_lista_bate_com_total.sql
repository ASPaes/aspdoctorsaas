-- A lista do card "Total de Atendimentos" (get_atendimento_chats_lista) tem que
-- devolver EXATAMENTE o conjunto que a agregada (get_atendimento_chats) contou.
--
-- Existe porque o WHERE está escrito DUAS VEZES, em funções diferentes. Foi
-- assim que os cards da tela de Atendimentos passaram a ignorar a busca: o
-- filtro mudou num lugar e não no outro, e ninguém viu até o print do usuário.
-- Este teste é a guarda. Mexeu numa das duas, rode.
--
-- Assere INVARIANTES, nunca números absolutos: o banco local está congelado em
-- 16/07/2026 e um número fixo quebraria na próxima carga.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/43_chats_lista_bate_com_total.sql
BEGIN;

DO $$
DECLARE
  v_uid     uuid;
  v_tenant  uuid;
  v_from    timestamptz := now() - interval '365 days';
  v_to      timestamptz := now();
  v_qtd     int;
  v_ag      jsonb;
  v_li      jsonb;
  v_dept    uuid;
  v_caso    text;
  v_plantao text;
  v_item    jsonb;
  v_ant     timestamptz;
BEGIN
  -- ========== 1. estrutura ==========
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats_lista';
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 1: esperava 1 get_atendimento_chats_lista, achei %', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public' AND routine_name = 'get_atendimento_chats_lista'
     AND privilege_type = 'EXECUTE' AND grantee IN ('authenticated','service_role');
  IF v_qtd <> 2 THEN
    RAISE EXCEPTION 'FALHOU 2: esperava EXECUTE para authenticated e service_role, achei %', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public' AND routine_name = 'get_atendimento_chats_lista'
     AND grantee IN ('anon','PUBLIC');
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 3: a lista não pode estar aberta para anon/PUBLIC (% grant(s))', v_qtd;
  END IF;

  -- ========== 2. contexto: super admin + tenant com mais volume ==========
  SELECT user_id INTO v_uid FROM public.profiles WHERE is_super_admin ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FALHOU 4: nenhum super admin no banco local'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT tenant_id INTO v_tenant
    FROM public.support_attendances
   WHERE opened_at >= v_from
   GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FALHOU 5: sem atendimentos no periodo'; END IF;

  SELECT department_id INTO v_dept
    FROM public.support_attendances
   WHERE tenant_id = v_tenant AND department_id IS NOT NULL AND opened_at >= v_from
   GROUP BY department_id ORDER BY count(*) DESC LIMIT 1;

  -- ========== 3. o total tem que bater em toda combinacao ==========
  FOREACH v_caso IN ARRAY ARRAY['sem filtro','plantao','comercial','setor','grupo','sentimento'] LOOP
    v_plantao := CASE v_caso WHEN 'plantao' THEN 'plantao'
                             WHEN 'comercial' THEN 'comercial' ELSE NULL END;

    IF v_caso = 'setor' THEN
      v_ag := public.get_atendimento_chats(v_tenant, v_from, v_to, v_dept,
                null,null,null,null,null,null,null,null,null,null,null,null,null,null);
      v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, v_dept,
                null,null,null,null,null,null,null,null,null,null,null,null,null,null, 200);
    ELSIF v_caso = 'grupo' THEN
      v_ag := public.get_atendimento_chats(v_tenant, v_from, v_to, null,
                null,null,null,null,null,null,null,null,null,null,false,null,null,null);
      v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
                null,null,null,null,null,null,null,null,null,null,false,null,null,null, 200);
    ELSIF v_caso = 'sentimento' THEN
      v_ag := public.get_atendimento_chats(v_tenant, v_from, v_to, null,
                null,null,null,null,null,null,null,null,null,null,null,ARRAY['negative'],null,null);
      v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
                null,null,null,null,null,null,null,null,null,null,null,ARRAY['negative'],null,null, 200);
    ELSE
      v_ag := public.get_atendimento_chats(v_tenant, v_from, v_to, null,
                null,null,null,null,null,null,null,null,null,null,null,null,null, v_plantao);
      v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
                null,null,null,null,null,null,null,null,null,null,null,null,null, v_plantao, 200);
    END IF;

    IF (v_ag->>'total')::int IS DISTINCT FROM (v_li->>'total')::int THEN
      RAISE EXCEPTION 'FALHOU 6 [%]: card=% e lista=% — os dois WHERE divergiram',
        v_caso, v_ag->>'total', v_li->>'total';
    END IF;

    -- itens = min(total, limite), e `truncado` coerente
    IF jsonb_array_length(v_li->'itens') <> LEAST((v_li->>'total')::int, 200) THEN
      RAISE EXCEPTION 'FALHOU 7 [%]: total=% mas vieram % itens (limite 200)',
        v_caso, v_li->>'total', jsonb_array_length(v_li->'itens');
    END IF;
    IF ((v_li->>'truncado')::boolean) <> ((v_li->>'total')::int > 200) THEN
      RAISE EXCEPTION 'FALHOU 8 [%]: truncado=% com total=%',
        v_caso, v_li->>'truncado', v_li->>'total';
    END IF;
  END LOOP;

  -- ========== 4. o recorte de plantao vale linha a linha ==========
  v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
            null,null,null,null,null,null,null,null,null,null,null,null,null,'plantao', 200);
  IF jsonb_array_length(v_li->'itens') = 0 THEN
    RAISE EXCEPTION 'FALHOU 9: nenhum atendimento de plantao no local — o teste perde o sentido';
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_li->'itens') LOOP
    IF (v_item->>'plantao')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'FALHOU 10: item % veio com plantao=% no recorte "so plantao"',
        v_item->>'attendance_code', v_item->>'plantao';
    END IF;
  END LOOP;

  -- e o inverso: "so comercial" nao pode trazer nenhum plantao
  v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
            null,null,null,null,null,null,null,null,null,null,null,null,null,'comercial', 200);
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_li->'itens') LOOP
    IF (v_item->>'plantao')::boolean IS TRUE THEN
      RAISE EXCEPTION 'FALHOU 11: item % é plantao e apareceu no recorte "so comercial"',
        v_item->>'attendance_code';
    END IF;
  END LOOP;

  -- ========== 5. ordem: do mais recente para o mais antigo ==========
  v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
            null,null,null,null,null,null,null,null,null,null,null,null,null,null, 50);
  v_ant := NULL;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_li->'itens') LOOP
    IF v_ant IS NOT NULL AND (v_item->>'opened_at')::timestamptz > v_ant THEN
      RAISE EXCEPTION 'FALHOU 12: lista fora de ordem em % (% depois de %)',
        v_item->>'attendance_code', v_item->>'opened_at', v_ant;
    END IF;
    v_ant := (v_item->>'opened_at')::timestamptz;
  END LOOP;

  -- ========== 6. o limite corta, mas o total continua inteiro ==========
  v_li := public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
            null,null,null,null,null,null,null,null,null,null,null,null,null,null, 5);
  IF jsonb_array_length(v_li->'itens') > 5 THEN
    RAISE EXCEPTION 'FALHOU 13: p_limit=5 devolveu % itens', jsonb_array_length(v_li->'itens');
  END IF;
  v_ag := public.get_atendimento_chats(v_tenant, v_from, v_to, null,
            null,null,null,null,null,null,null,null,null,null,null,null,null,null);
  IF (v_li->>'total')::int IS DISTINCT FROM (v_ag->>'total')::int THEN
    RAISE EXCEPTION 'FALHOU 14: com p_limit=5 o total virou % (esperado %) — o limite nao pode mexer no total',
      v_li->>'total', v_ag->>'total';
  END IF;

  -- ========== 7. parametro invalido é recusado ==========
  BEGIN
    PERFORM public.get_atendimento_chats_lista(v_tenant, v_from, v_to, null,
      null,null,null,null,null,null,null,null,null,null,null,null,null,'PLANTAO', 10);
    RAISE EXCEPTION 'FALHOU 15: aceitou p_plantao="PLANTAO"';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'FALHOU 15%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'OK: get_atendimento_chats_lista bate com o card em todos os casos';
END $$;

ROLLBACK;
