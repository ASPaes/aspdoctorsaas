-- Schema da etapa que encerra a contagem de SLA.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/21_encerra_sla_schema.sql
BEGIN;

DO $$
DECLARE
  v_pipe uuid; v_s1 uuid; v_s2 uuid; v_tenant uuid; v_ord1 int; v_ord2 int;
BEGIN
  -- pipeline real com pelo menos 2 etapas ativas
  SELECT p.id, p.tenant_id INTO v_pipe, v_tenant
    FROM public.onboarding_pipelines p
   WHERE (SELECT count(*) FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo) >= 2
   ORDER BY p.position LIMIT 1;
  IF v_pipe IS NULL THEN RAISE EXCEPTION 'PRE: nenhum pipeline com 2+ etapas ativas'; END IF;

  SELECT id INTO v_s1 FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo ORDER BY position LIMIT 1;
  SELECT id INTO v_s2 FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND id <> v_s1 ORDER BY position LIMIT 1;

  -- 1. a coluna existe e nasce false
  IF EXISTS (SELECT 1 FROM public.onboarding_stages WHERE encerra_sla) THEN
    RAISE EXCEPTION 'FALHA 1: alguma etapa já nasceu com encerra_sla true';
  END IF;

  -- 2. marcar uma etapa funciona
  UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_s1;

  -- 3. marcar a SEGUNDA do mesmo pipeline viola o índice único
  BEGIN
    UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_s2;
    RAISE EXCEPTION 'FALHA 3: aceitou duas etapas com encerra_sla no mesmo pipeline';
  EXCEPTION WHEN unique_violation THEN
    NULL; -- esperado
  END;

  -- 4. fn_onb_stage_ordem é crescente na ordem do trilho
  v_ord1 := public.fn_onb_stage_ordem(v_s1);
  v_ord2 := public.fn_onb_stage_ordem(v_s2);
  IF v_ord1 IS NULL OR v_ord2 IS NULL THEN RAISE EXCEPTION 'FALHA 4a: fn_onb_stage_ordem devolveu NULL'; END IF;
  IF v_ord1 >= v_ord2 THEN RAISE EXCEPTION 'FALHA 4b: ordem % não é menor que %', v_ord1, v_ord2; END IF;

  -- 5. etapa de jornada posterior tem ordem maior que qualquer etapa de jornada anterior
  IF EXISTS (
    SELECT 1
      FROM public.onboarding_stages s1
      JOIN public.onboarding_pipelines p1 ON p1.id = s1.pipeline_id
      JOIN public.onboarding_phases f1 ON f1.id = p1.phase_id
      JOIN public.onboarding_pipelines p2 ON p2.tenant_id = p1.tenant_id
      JOIN public.onboarding_phases f2 ON f2.id = p2.phase_id AND f2.position > f1.position
      JOIN public.onboarding_stages s2 ON s2.pipeline_id = p2.id AND s2.ativo
     WHERE s1.ativo
       AND public.fn_onb_stage_ordem(s1.id) >= public.fn_onb_stage_ordem(s2.id)
  ) THEN
    RAISE EXCEPTION 'FALHA 5: ordem não respeita a posição da jornada';
  END IF;

  -- 6. marcos na jornada existem
  PERFORM sla_encerrado_em, sla_encerrado_stage_id FROM public.onboarding_journeys LIMIT 1;

  RAISE NOTICE 'OK 21_encerra_sla_schema';
END $$;

ROLLBACK;
