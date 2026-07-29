-- Asserções da Task 6 (Entrega A): view por fase bate com a view antiga.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/12_vw_onboarding_journey_phases.sql
BEGIN;

DO $$
DECLARE v_qtd int; v_opts text;
BEGIN
  -- 1. a view existe com security_invoker ligado
  SELECT array_to_string(reloptions, ',') INTO v_opts
    FROM pg_class WHERE oid = 'public.vw_onboarding_journey_phases'::regclass;
  IF v_opts IS NULL OR v_opts NOT LIKE '%security_invoker=on%' THEN
    RAISE EXCEPTION 'FALHOU 1: view sem security_invoker=on (reloptions=%)', COALESCE(v_opts,'<null>');
  END IF;

  -- 2. toda linha de phase_metrics aparece na view
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_phase_metrics m
   WHERE NOT EXISTS (SELECT 1 FROM public.vw_onboarding_journey_phases v
                      WHERE v.journey_id = m.journey_id AND v.phase_id = m.phase_id);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2: % linha(s) de phase_metrics fora da view', v_qtd; END IF;

  -- 3. `aberta` é exatamente concluida_em IS NULL
  SELECT count(*) INTO v_qtd FROM public.vw_onboarding_journey_phases
   WHERE aberta <> (concluida_em IS NULL);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % linha(s) com flag aberta incoerente', v_qtd; END IF;

  -- 4. o SLA útil da fase onboarding bate com sla_onb_util_min da view antiga (tolerância 1 min)
  SELECT count(*) INTO v_qtd
    FROM public.vw_onboarding_journeys a
    JOIN public.vw_onboarding_journey_phases p
      ON p.journey_id = a.journey_id AND p.phase_slug = 'onboarding'
   WHERE abs(p.sla_util_min - a.sla_onb_util_min) > 1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % jornada(s) com SLA de onboarding divergente da view antiga', v_qtd; END IF;

  -- 5. idem para implantação — só onde o marco implantacao_iniciada_em existe.
  --    Sem o marco, a view antiga reporta 0 (ver asserção 5b): é bug dela, não da nova.
  SELECT count(*) INTO v_qtd
    FROM public.vw_onboarding_journeys a
    JOIN public.onboarding_journeys j ON j.id = a.journey_id
    JOIN public.vw_onboarding_journey_phases p
      ON p.journey_id = a.journey_id AND p.phase_slug = 'implantacao'
   WHERE j.implantacao_iniciada_em IS NOT NULL
     AND abs(p.sla_util_min - a.sla_imp_util_min) > 1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) com SLA de implantação divergente da view antiga', v_qtd; END IF;

  -- 5b. Divergência intencional e documentada: jornada que entrou em implantação por
  --     move_onboarding_stage (arrastar o cartão) fica sem implantacao_iniciada_em, e a
  --     view antiga zera o SLA da fase. A view nova usa o histórico de etapas e reporta
  --     o tempo real. Aqui provamos que a nova CORRIGE o zero em vez de repeti-lo.
  SELECT count(*) INTO v_qtd
    FROM public.vw_onboarding_journeys a
    JOIN public.onboarding_journeys j ON j.id = a.journey_id
    JOIN public.vw_onboarding_journey_phases p
      ON p.journey_id = a.journey_id AND p.phase_slug = 'implantacao'
   WHERE j.implantacao_iniciada_em IS NULL
     AND (p.iniciada_em IS NULL OR p.sla_util_min < a.sla_imp_util_min);
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 5b: % jornada(s) sem marco de implantação continuaram com SLA zerado', v_qtd;
  END IF;

  -- 6. o pausado da fase bate com o da view antiga
  SELECT count(*) INTO v_qtd
    FROM public.vw_onboarding_journeys a
    JOIN public.vw_onboarding_journey_phases p
      ON p.journey_id = a.journey_id AND p.phase_slug = 'onboarding'
   WHERE p.sla_pausado_min <> a.sla_onb_pausado_min;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 6: % jornada(s) com pausa de onboarding divergente', v_qtd; END IF;

  RAISE NOTICE 'OK: 12_vw_onboarding_journey_phases — 6 asserções passaram';
END $$;

ROLLBACK;
