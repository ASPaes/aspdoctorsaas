-- Asserções das Tasks 2, 3 e 4 (Entrega A): colunas phase_id e sincronização com o enum.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/10_onboarding_phase_id_sync.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_phase_acomp uuid; v_pipe uuid; v_slug text; v_qtd int; v_fase text;
  v_journey uuid;
BEGIN
  SELECT j.tenant_id INTO v_tenant
    FROM public.onboarding_journeys j
   GROUP BY j.tenant_id ORDER BY count(*) DESC LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: nenhum tenant com jornada de onboarding'; END IF;

  -- 1. toda pipeline existente tem phase_id preenchido e batendo com o enum
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_pipelines p
    LEFT JOIN public.onboarding_phases f ON f.id = p.phase_id
   WHERE p.phase_id IS NULL OR f.slug IS DISTINCT FROM p.fase::text;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 1: % pipeline(s) com phase_id ausente ou divergente do enum', v_qtd; END IF;

  -- 2. insert legado (só com `fase`) ganha phase_id pelo trigger
  INSERT INTO public.onboarding_pipelines (tenant_id, nome, fase, ativo, position)
  VALUES (v_tenant, 'ZZ Pipe Legado', 'implantacao', true, 99) RETURNING id INTO v_pipe;
  SELECT f.slug INTO v_slug FROM public.onboarding_pipelines p
    JOIN public.onboarding_phases f ON f.id = p.phase_id WHERE p.id = v_pipe;
  IF v_slug IS DISTINCT FROM 'implantacao' THEN
    RAISE EXCEPTION 'FALHOU 2: trigger não resolveu phase_id no insert legado (achei %)', COALESCE(v_slug,'<null>');
  END IF;

  -- 3. insert novo (só com phase_id) numa fase sem equivalente no enum é aceito, com `fase` nula
  SELECT public.fn_onboarding_phase_id(v_tenant, 'acompanhamento') INTO v_phase_acomp;
  INSERT INTO public.onboarding_pipelines (tenant_id, nome, phase_id, ativo, position)
  VALUES (v_tenant, 'ZZ Pipe Acompanhamento', v_phase_acomp, true, 98) RETURNING id INTO v_pipe;
  SELECT fase::text INTO v_fase FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_fase IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 3: fase deveria ser nula numa jornada fora do enum, achei %', v_fase;
  END IF;

  -- 4. onboarding_phase_metrics: toda linha existente tem phase_id coerente com `fase`
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_phase_metrics m
    LEFT JOIN public.onboarding_phases f ON f.id = m.phase_id
   WHERE m.phase_id IS NULL OR f.slug IS DISTINCT FROM m.fase::text;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % linha(s) de phase_metrics com phase_id ausente ou divergente', v_qtd; END IF;

  -- 5. onboarding_journeys: current_phase_id coerente com fase_atual
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
    LEFT JOIN public.onboarding_phases f ON f.id = j.current_phase_id
   WHERE (j.fase_atual::text = 'concluido' AND j.current_phase_id IS NOT NULL)
      OR (j.fase_atual::text <> 'concluido' AND f.slug IS DISTINCT FROM j.fase_atual::text);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) com current_phase_id divergente de fase_atual', v_qtd; END IF;

  -- 6. UPDATE legado de fase_atual reflete em current_phase_id
  SELECT id INTO v_journey FROM public.onboarding_journeys
   WHERE tenant_id = v_tenant ORDER BY created_at LIMIT 1;

  UPDATE public.onboarding_journeys SET fase_atual='implantacao' WHERE id = v_journey;
  PERFORM 1 FROM public.onboarding_journeys j
    JOIN public.onboarding_phases f ON f.id = j.current_phase_id
   WHERE j.id = v_journey AND f.slug = 'implantacao';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 6: trigger não sincronizou current_phase_id no UPDATE de fase_atual'; END IF;

  -- 7. fase_atual='concluido' zera current_phase_id
  UPDATE public.onboarding_journeys SET fase_atual='concluido' WHERE id = v_journey;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_journey AND current_phase_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: jornada concluída deveria ficar com current_phase_id nulo'; END IF;

  RAISE NOTICE 'OK: 10_onboarding_phase_id_sync — 7 asserções passaram';
END $$;

ROLLBACK;
