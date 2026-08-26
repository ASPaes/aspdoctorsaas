-- Descarte manual do risco de churn (admin/head).
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/15_churn_dismiss.sql
--
-- Sem fixture sintética: whatsapp_conversations/support_attendances carregam
-- dezenas de triggers e realtime, e INSERT de mentira quebra em constraint que
-- nada tem a ver com o que se quer provar. O teste escolhe uma conversa REAL
-- que já tem atendimento ativo + análise, e desfaz tudo no ROLLBACK.
BEGIN;

DO $$
DECLARE
  v_conv    uuid;
  v_tenant  uuid;
  v_att     uuid;
  v_admin   uuid;
  v_user    uuid;
  v_qtd     int;
  v_res     jsonb;
  v_ok      boolean;
BEGIN
  -- 1. as 3 colunas existem
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='whatsapp_sentiment_analysis'
     AND column_name IN ('churn_dismissed_at','churn_dismissed_by','churn_dismissed_attendance_id');
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 1: achei % das 3 colunas de descarte', v_qtd; END IF;

  -- 2. as 3 funções existem e estão fechadas para PUBLIC / abertas para authenticated
  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema='public'
     AND routine_name IN ('toggle_churn_dismiss','fn_churn_descarte_ativo','fn_conversa_atendimento_ativo')
     AND grantee='authenticated' AND privilege_type='EXECUTE';
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 2: % das 3 funcoes com EXECUTE para authenticated', v_qtd; END IF;

  SELECT count(*) INTO v_qtd
    FROM information_schema.routine_privileges
   WHERE routine_schema='public'
     AND routine_name IN ('toggle_churn_dismiss','fn_churn_descarte_ativo','fn_conversa_atendimento_ativo')
     AND grantee='PUBLIC';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2b: % grants para PUBLIC sobraram', v_qtd; END IF;

  -- fixture: conversa real com atendimento ativo e analise de sentimento
  SELECT s.conversation_id, c.tenant_id, a.id
    INTO v_conv, v_tenant, v_att
    FROM public.whatsapp_sentiment_analysis s
    JOIN public.whatsapp_conversations c ON c.id = s.conversation_id
    JOIN public.support_attendances a ON a.conversation_id = c.id
     AND a.status IN ('waiting','in_progress')
   WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.tenant_id = c.tenant_id AND p.role='admin')
   LIMIT 1;
  IF v_conv IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: nenhuma conversa com atendimento ativo + analise'; END IF;

  SELECT p.user_id INTO v_admin FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role='admin' AND COALESCE(p.is_super_admin,false)=false LIMIT 1;
  SELECT p.user_id INTO v_user FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role='user' AND COALESCE(p.is_super_admin,false)=false LIMIT 1;
  IF v_admin IS NULL THEN RAISE EXCEPTION 'SEM FIXTURE: tenant % sem admin nao-super', v_tenant; END IF;

  -- 3. fn_conversa_atendimento_ativo devolve o atendimento aberto
  IF public.fn_conversa_atendimento_ativo(v_conv) IS DISTINCT FROM v_att THEN
    RAISE EXCEPTION 'FALHOU 3: atendimento ativo veio % , esperava %',
      public.fn_conversa_atendimento_ativo(v_conv), v_att;
  END IF;

  -- 4. sem descarte gravado, fn_churn_descarte_ativo e false
  UPDATE public.whatsapp_sentiment_analysis
     SET churn_dismissed_at=NULL, churn_dismissed_by=NULL, churn_dismissed_attendance_id=NULL
   WHERE conversation_id = v_conv;
  IF public.fn_churn_descarte_ativo(v_conv) THEN
    RAISE EXCEPTION 'FALHOU 4: descarte ativo sem ninguem ter descartado';
  END IF;

  -- 5. operador comum (role user) e barrado
  IF v_user IS NOT NULL THEN
    BEGIN
      EXECUTE 'SET LOCAL role authenticated';
      EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_user, 'role','authenticated')::text);
      BEGIN
        PERFORM public.toggle_churn_dismiss(v_conv, true);
        EXECUTE 'RESET role';
        RAISE EXCEPTION 'FALHOU 5: operador role=user conseguiu descartar';
      EXCEPTION WHEN raise_exception THEN
        IF SQLERRM LIKE 'FALHOU 5%' THEN RAISE; END IF;
      END;
      EXECUTE 'RESET role';
    END;
  ELSE
    RAISE NOTICE 'PULADO 5: tenant % nao tem profile role=user para o teste negativo', v_tenant;
  END IF;

  -- 6. admin descarta -> descarte fica ativo e ancorado no atendimento
  EXECUTE 'SET LOCAL role authenticated';
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role','authenticated')::text);
  v_res := public.toggle_churn_dismiss(v_conv, true);
  EXECUTE 'RESET role';

  IF NOT (v_res->>'ok')::boolean OR NOT (v_res->>'dismissed')::boolean THEN
    RAISE EXCEPTION 'FALHOU 6: toggle devolveu %', v_res;
  END IF;
  IF NOT public.fn_churn_descarte_ativo(v_conv) THEN
    RAISE EXCEPTION 'FALHOU 6b: descarte nao ficou ativo';
  END IF;
  SELECT count(*) INTO v_qtd FROM public.whatsapp_sentiment_analysis
   WHERE conversation_id = v_conv AND churn_dismissed_attendance_id = v_att AND churn_dismissed_by = v_admin;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6c: ancora/autor do descarte nao gravados'; END IF;

  -- 7. a reanalise da IA (upsert da edge function) NAO apaga o descarte.
  --    Reproduz exatamente as colunas que a function manda no upsert.
  UPDATE public.whatsapp_sentiment_analysis
     SET sentiment='negative', confidence=0.9, summary='reanalise', keywords='{}',
         needs_cs_ticket=true, cs_ticket_reason='de novo'
   WHERE conversation_id = v_conv;
  IF NOT public.fn_churn_descarte_ativo(v_conv) THEN
    RAISE EXCEPTION 'FALHOU 7: reanalise apagou o descarte';
  END IF;

  -- 8. atendimento fechou -> a ancora deixa de bater -> descarte expira sozinho.
  --    Simulado trocando a ancora (fechar o atendimento de verdade dispararia
  --    CSAT, analise de IA e fn_block_close_without_cliente).
  UPDATE public.whatsapp_sentiment_analysis
     SET churn_dismissed_attendance_id = gen_random_uuid()
   WHERE conversation_id = v_conv;
  IF public.fn_churn_descarte_ativo(v_conv) THEN
    RAISE EXCEPTION 'FALHOU 8: descarte sobreviveu a troca de atendimento';
  END IF;

  -- 9. toggle desfaz (admin errou e volta atras)
  UPDATE public.whatsapp_sentiment_analysis
     SET churn_dismissed_attendance_id = v_att WHERE conversation_id = v_conv;
  EXECUTE 'SET LOCAL role authenticated';
  EXECUTE format('SET LOCAL request.jwt.claims = %L', json_build_object('sub', v_admin, 'role','authenticated')::text);
  v_res := public.toggle_churn_dismiss(v_conv);
  EXECUTE 'RESET role';
  IF (v_res->>'dismissed')::boolean THEN RAISE EXCEPTION 'FALHOU 9: toggle nao desfez, devolveu %', v_res; END IF;
  IF public.fn_churn_descarte_ativo(v_conv) THEN RAISE EXCEPTION 'FALHOU 9b: descarte continua ativo apos desfazer'; END IF;
  SELECT count(*) INTO v_qtd FROM public.whatsapp_sentiment_analysis
   WHERE conversation_id = v_conv AND (churn_dismissed_by IS NOT NULL OR churn_dismissed_attendance_id IS NOT NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 9c: desfazer deixou autor/ancora para tras'; END IF;

  RAISE NOTICE 'OK: 9 asserções passaram (conversa %, tenant %)', v_conv, v_tenant;
END $$;

ROLLBACK;
