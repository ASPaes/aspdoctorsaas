-- Encerrar/cancelar jornada tem que fechar a etapa com duracao_util_minutos (12/08).
--
-- conclude_onboarding_journey e cancel_onboarding_journey gravavam só duracao_minutos.
-- A etapa final de toda jornada encerrada saía do painel de SLA em horário útil:
-- eram 28 linhas em 27 jornadas, 11.650 minutos úteis invisíveis.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/33_encerramento_grava_duracao_util.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_ticket uuid; v_uid uuid;
  v_hist uuid; v_util int; v_corrido int; v_res jsonb;
BEGIN
  -- ── fixture: jornada real em andamento, com etapa aberta
  SELECT j.id, j.tenant_id, j.ticket_id INTO v_journey, v_tenant, v_ticket
    FROM public.onboarding_journeys j
   WHERE j.situacao = 'em_andamento' AND j.current_stage_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.onboarding_stage_history h
                  WHERE h.journey_id = j.id AND h.saiu_em IS NULL)
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento com etapa aberta'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  -- a etapa aberta precisa ter entrado ANTES de agora, senão a duração útil é 0
  -- legitimamente e o teste não distingue "0 calculado" de "nunca calculado".
  UPDATE public.onboarding_stage_history
     SET entrou_em = now() - interval '3 days'
   WHERE journey_id = v_journey AND saiu_em IS NULL;

  -- treino em aberto faz a RPC recusar por outro motivo — fora do escopo deste teste
  UPDATE public.onboarding_training_sessions SET status = 'realizado'
   WHERE ticket_id IN (SELECT id FROM public.support_tickets WHERE parent_ticket_id = v_ticket)
     AND status NOT IN ('realizado','cancelado');

  SELECT id INTO v_hist FROM public.onboarding_stage_history
   WHERE journey_id = v_journey AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;

  -- ── ação: encerrar
  v_res := public.conclude_onboarding_journey(v_journey, NULL, 'teste duracao util');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'RPC recusou o encerramento: %', v_res; END IF;

  SELECT duracao_util_minutos, duracao_minutos INTO v_util, v_corrido
    FROM public.onboarding_stage_history WHERE id = v_hist;

  IF v_util IS NULL THEN
    RAISE EXCEPTION 'FALHA 1: conclude fechou a etapa sem duracao_util_minutos (corrido=%)', v_corrido;
  END IF;
  IF v_corrido IS NULL THEN RAISE EXCEPTION 'FALHA 2: conclude fechou sem duracao_minutos'; END IF;
  IF v_util > v_corrido THEN
    RAISE EXCEPTION 'FALHA 3: util (%) nao pode passar do corrido (%)', v_util, v_corrido;
  END IF;

  RAISE NOTICE 'OK 33 parte 1: conclude grava util=% corrido=%', v_util, v_corrido;
END $$;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_uid uuid; v_hist uuid;
  v_util int; v_corrido int; v_res jsonb;
BEGIN
  SELECT j.id, j.tenant_id INTO v_journey, v_tenant
    FROM public.onboarding_journeys j
   WHERE j.situacao = 'em_andamento' AND j.current_stage_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.onboarding_stage_history h
                  WHERE h.journey_id = j.id AND h.saiu_em IS NULL)
   ORDER BY j.created_at ASC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada para o cancelamento'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role','authenticated')::text, true);

  UPDATE public.onboarding_stage_history
     SET entrou_em = now() - interval '3 days'
   WHERE journey_id = v_journey AND saiu_em IS NULL;

  SELECT id INTO v_hist FROM public.onboarding_stage_history
   WHERE journey_id = v_journey AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;

  v_res := public.cancel_onboarding_journey(v_journey, 'teste duracao util');
  IF (v_res->>'ok') <> 'true' THEN RAISE EXCEPTION 'RPC recusou o cancelamento: %', v_res; END IF;

  SELECT duracao_util_minutos, duracao_minutos INTO v_util, v_corrido
    FROM public.onboarding_stage_history WHERE id = v_hist;

  IF v_util IS NULL THEN
    RAISE EXCEPTION 'FALHA 4: cancel fechou a etapa sem duracao_util_minutos (corrido=%)', v_corrido;
  END IF;

  RAISE NOTICE 'OK 33 parte 2: cancel grava util=% corrido=%', v_util, v_corrido;
END $$;

-- ── a invariante global: nenhuma etapa fechada sem duração útil
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.onboarding_stage_history
   WHERE saiu_em IS NOT NULL AND duracao_util_minutos IS NULL;
  IF v_n > 0 THEN RAISE EXCEPTION 'FALHA 5: % etapa(s) fechada(s) sem duracao_util', v_n; END IF;
  RAISE NOTICE 'OK 33 parte 3: invariante global';
END $$;

ROLLBACK;
