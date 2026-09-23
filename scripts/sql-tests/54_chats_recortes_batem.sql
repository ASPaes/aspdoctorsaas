-- Cada card da aba Chats abre a lista dos atendimentos que formaram AQUELE
-- numero. O recorte vira parametro de get_atendimento_chats_lista, e o total
-- que a lista devolve tem que ser identico ao que get_atendimento_chats
-- mostrou na barra. Se os dois se separarem, o usuario clica em "594" e ve
-- outra quantidade — que e exatamente o tipo de bug que derrubou a confianca
-- no painel antes (ver 43_chats_lista_bate_com_total.sql, a mesma guarda para
-- o total da aba).
--
-- Cobre os 11 recortes: sentimento, resolucao, status, nota de CSAT, atendente
-- com dono, atendente SEM dono, cliente, categoria, hora do dia, dia da semana
-- e celula do mapa de calor (hora + dia juntos).
--
-- Assere INVARIANTES, nunca numeros absolutos.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/54_chats_recortes_batem.sql
BEGIN;

DO $$
DECLARE
  v_uid    uuid;
  v_tenant uuid;
  v_from   timestamptz := now() - interval '365 days';
  v_to     timestamptz := now();
  v_qtd    int;
  v_ag     jsonb;
  v_e      jsonb;
  v_esp    bigint;
  v_obt    bigint;
  v_casos  int := 0;
  v_falhas text := '';
BEGIN
  -- ========== 1. estrutura: os parametros de recorte existem ==========
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats_lista';
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 1: esperava 1 get_atendimento_chats_lista, achei % (sobrecarga deixa o PostgREST escolher errado)', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace,
         unnest(p.proargnames) a(nome)
   WHERE n.nspname = 'public' AND p.proname = 'get_atendimento_chats_lista'
     AND a.nome IN ('p_csat_scores','p_sem_agente','p_cliente_ids','p_horas','p_dows','p_status');
  IF v_qtd <> 6 THEN
    RAISE EXCEPTION 'FALHOU 2: esperava os 6 parametros de recorte, achei %', v_qtd;
  END IF;

  -- a lista continua fechada para anon/PUBLIC depois do DROP+CREATE
  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public' AND routine_name = 'get_atendimento_chats_lista'
     AND grantee IN ('anon','PUBLIC');
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 3: a lista nao pode estar aberta para anon/PUBLIC (% grant(s))', v_qtd;
  END IF;

  -- ========== 2. contexto ==========
  SELECT user_id INTO v_uid FROM public.profiles WHERE is_super_admin ORDER BY created_at LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'FALHOU 4: nenhum super admin no banco local'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  SELECT tenant_id INTO v_tenant
    FROM public.support_attendances
   WHERE opened_at >= v_from
   GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FALHOU 5: nenhum atendimento no periodo'; END IF;

  v_ag := public.get_atendimento_chats(v_tenant, v_from, v_to);

  -- ========== 3. cada recorte reabre o conjunto que formou a barra ==========
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'por_sentimento') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_sentiments := ARRAY[v_e->>'sentimento'])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' sentimento=%s card=%s lista=%s;', v_e->>'sentimento', v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'por_resolucao') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_resolucoes := ARRAY[v_e->>'resolucao'])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' resolucao=%s card=%s lista=%s;', v_e->>'resolucao', v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'por_status') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_status := ARRAY[v_e->>'status'])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' status=%s card=%s lista=%s;', v_e->>'status', v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'csat'->'distribuicao') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_csat_scores := ARRAY[(v_e->>'nota')::int])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' csat=%s card=%s lista=%s;', v_e->>'nota', v_esp, v_obt); END IF;
  END LOOP;

  -- atendente: com dono pelo user_id, sem dono pelo p_sem_agente
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'por_atendente') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    IF v_e->>'user_id' IS NULL THEN
      v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                  p_sem_agente := true)->>'total')::bigint;
    ELSE
      v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                  p_agent_id := (v_e->>'user_id')::uuid)->>'total')::bigint;
    END IF;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' atendente=%s card=%s lista=%s;', COALESCE(v_e->>'user_id','(sem)'), v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'ofensores') LOOP
    CONTINUE WHEN v_e->>'cliente_id' IS NULL;
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_cliente_ids := ARRAY[(v_e->>'cliente_id')::uuid])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' cliente=%s card=%s lista=%s;', v_e->>'cliente_id', v_esp, v_obt); END IF;
  END LOOP;

  -- categoria: NULL vira o uuid zero, a opcao "Sem categoria" da DEM-0315
  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'por_categoria') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_category_ids := ARRAY[COALESCE((v_e->>'category_id')::uuid,
                                                 '00000000-0000-0000-0000-000000000000'::uuid)])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' categoria=%s card=%s lista=%s;', COALESCE(v_e->>'category_id','(sem)'), v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT jsonb_build_object('hora', hora, 'qtd', qtd)
             FROM (SELECT (e->>'hora')::int AS hora, sum((e->>'qtd')::bigint) AS qtd
                     FROM jsonb_array_elements(v_ag->'heatmap') e GROUP BY 1) h LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_horas := ARRAY[(v_e->>'hora')::int])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' hora=%s card=%s lista=%s;', v_e->>'hora', v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT jsonb_build_object('dow', dow, 'qtd', qtd)
             FROM (SELECT (e->>'dow')::int AS dow, sum((e->>'qtd')::bigint) AS qtd
                     FROM jsonb_array_elements(v_ag->'heatmap') e GROUP BY 1) d LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_dows := ARRAY[(v_e->>'dow')::int])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' dow=%s card=%s lista=%s;', v_e->>'dow', v_esp, v_obt); END IF;
  END LOOP;

  FOR v_e IN SELECT * FROM jsonb_array_elements(v_ag->'heatmap') LOOP
    v_esp := (v_e->>'qtd')::bigint;
    v_obt := (public.get_atendimento_chats_lista(v_tenant, v_from, v_to,
                p_horas := ARRAY[(v_e->>'hora')::int],
                p_dows  := ARRAY[(v_e->>'dow')::int])->>'total')::bigint;
    v_casos := v_casos + 1;
    IF v_esp <> v_obt THEN v_falhas := v_falhas || format(' celula %sx%s card=%s lista=%s;', v_e->>'dow', v_e->>'hora', v_esp, v_obt); END IF;
  END LOOP;

  IF v_falhas <> '' THEN
    RAISE EXCEPTION 'FALHOU 6: recorte nao bate com o card:%', v_falhas;
  END IF;

  -- sem casos nenhum o teste seria verde a toa
  IF v_casos < 10 THEN
    RAISE EXCEPTION 'FALHOU 7: so % recortes testados, amostra pequena demais para valer', v_casos;
  END IF;

  RAISE NOTICE 'OK: % recortes conferidos, todos batem com o card', v_casos;
END $$;

ROLLBACK;
