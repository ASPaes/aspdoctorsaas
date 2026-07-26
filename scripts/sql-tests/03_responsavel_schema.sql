-- Asserções da Task 5: responsável explícito + histórico.
BEGIN;

DO $$
DECLARE
  v_qtd  int;
  v_jid  uuid;
  v_uid  uuid;
BEGIN
  -- 1. coluna responsavel_user_id existe
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_journeys' AND column_name='responsavel_user_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: onboarding_journeys.responsavel_user_id não existe'; END IF;

  -- 2. tabela de histórico existe com as 9 colunas
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_responsavel_history'
     AND column_name IN ('id','tenant_id','journey_id','user_id','de','ate','motivo','transferido_por','created_at');
  IF v_qtd <> 9 THEN RAISE EXCEPTION 'FALHOU 2: histórico tem % das 9 colunas', v_qtd; END IF;

  -- 3. RLS com 4 policies, todas TO authenticated (padrão do módulo)
  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_responsavel_history'
     AND roles::text = '{authenticated}';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 3: esperava 4 policies TO authenticated no histórico, achei %', v_qtd; END IF;

  -- 4. backfill: toda jornada que tinha implantador tem responsavel_user_id
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NULL
     AND EXISTS (
       SELECT 1 FROM public.onboarding_participants op
        JOIN public.onboarding_participant_roles r ON r.id = op.role_id
       WHERE op.ticket_id = j.ticket_id AND r.slug = 'implantador');
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % jornada(s) com implantador mas sem responsavel_user_id', v_qtd; END IF;

  -- 5. backfill: toda jornada com responsável tem exatamente 1 período aberto
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NOT NULL
     AND (SELECT count(*) FROM public.onboarding_responsavel_history h
           WHERE h.journey_id = j.id AND h.ate IS NULL) <> 1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) sem exatamente 1 período aberto', v_qtd; END IF;

  -- 6. o período aberto bate com a coluna da jornada
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
    JOIN public.onboarding_responsavel_history h ON h.journey_id = j.id AND h.ate IS NULL
   WHERE h.user_id <> j.responsavel_user_id;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 6: % período(s) aberto(s) divergindo da jornada', v_qtd; END IF;

  -- 7. não é possível ter dois períodos abertos na mesma jornada
  SELECT j.id, j.responsavel_user_id INTO v_jid, v_uid
    FROM public.onboarding_journeys j WHERE j.responsavel_user_id IS NOT NULL LIMIT 1;
  IF v_jid IS NULL THEN RAISE EXCEPTION 'FALHOU 7: sem jornada com responsável para testar'; END IF;
  BEGIN
    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id)
    SELECT tenant_id, v_jid, v_uid FROM public.onboarding_journeys WHERE id = v_jid;
    RAISE EXCEPTION 'FALHOU 7: segundo período aberto deveria violar a unique parcial';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 8. a view lê a coluna nova, não mais o participante mais antigo
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='vw_onboarding_journeys'
     AND pg_get_viewdef(c.oid, true) LIKE '%j.responsavel_user_id%';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8a: view não usa j.responsavel_user_id'; END IF;
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='vw_onboarding_journeys'
     AND pg_get_viewdef(c.oid, true) LIKE '%onboarding_participants op%';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 8b: view ainda deriva responsável de onboarding_participants'; END IF;

  -- 9. a view continua devolvendo o nome do responsável
  SELECT count(*) INTO v_qtd FROM public.vw_onboarding_journeys
   WHERE responsavel_user_id IS NOT NULL AND responsavel_nome IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 9: % jornada(s) com responsável sem nome resolvido', v_qtd; END IF;

  -- 10. a view NÃO pode perder security_invoker=on ao ser recriada.
  --     Sem isso ela passaria a rodar como o dono (postgres) e furaria o RLS
  --     das tabelas de baixo — regressão silenciosa de segurança.
  PERFORM 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname='public' AND c.relname='vw_onboarding_journeys'
     AND 'security_invoker=on' = ANY(c.reloptions);
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 10: vw_onboarding_journeys perdeu security_invoker=on'; END IF;

  RAISE NOTICE 'OK: 03_responsavel_schema — 10 asserções passaram';
END $$;

ROLLBACK;
