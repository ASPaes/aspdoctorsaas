-- Gate de etapa x checklist por demanda (11/08): item obrigatório que não aparece não pode travar.
-- Cobre os DOIS caminhos de contagem: jornada sem snapshot (v_mat=0) e jornada com snapshot.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/32_checklist_demanda_gate.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_stage uuid; v_target uuid; v_uid uuid;
  v_dt_a uuid; v_dt_b uuid; v_g_a uuid; v_res jsonb;
BEGIN
  SELECT j.id, j.tenant_id, j.current_stage_id INTO v_journey, v_tenant, v_stage
    FROM public.onboarding_journeys j
   WHERE j.current_stage_id IS NOT NULL AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento com etapa'; END IF;

  SELECT s2.id INTO v_target
    FROM public.onboarding_stages s1
    JOIN public.onboarding_stages s2 ON s2.pipeline_id = s1.pipeline_id AND s2.id <> s1.id AND s2.ativo
   WHERE s1.id = v_stage
   ORDER BY s2.position LIMIT 1;
  IF v_target IS NULL THEN RAISE EXCEPTION 'PRE: pipeline com uma etapa só'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  DELETE FROM public.onboarding_journey_checklist WHERE journey_id = v_journey AND stage_id = v_stage;
  DELETE FROM public.onboarding_stage_checklist WHERE stage_id = v_stage;
  DELETE FROM public.onboarding_stage_checklist_groups WHERE stage_id = v_stage;

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-A') RETURNING id INTO v_dt_a;
  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-B') RETURNING id INTO v_dt_b;
  UPDATE public.onboarding_journeys SET demand_type_id = v_dt_b WHERE id = v_journey;

  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE So A', 90) RETURNING id INTO v_g_a;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_a);
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position)
    VALUES (v_tenant, v_stage, v_g_a, 'obrigatorio so da demanda A', true, 0);

  -- Caminho 1: jornada SEM snapshot (v_mat = 0). Demanda B não vê o item → não pode travar.
  v_res := public.move_onboarding_stage(v_journey, v_target);
  IF (v_res->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'sem snapshot: item de outra demanda travou a etapa: %', v_res; END IF;

  -- volta o cartão para a etapa de origem
  UPDATE public.onboarding_journeys SET current_stage_id = v_stage WHERE id = v_journey;

  -- Caminho 2: jornada COM snapshot. O sync não materializa o item (demanda B).
  PERFORM public.sync_journey_stage_checklist(v_journey, v_stage);
  INSERT INTO public.onboarding_journey_checklist
    (tenant_id, journey_id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem, done)
  VALUES (v_tenant, v_journey, v_stage, 'Manual', 0, 'item manual opcional', false, 0, 'manual', false);

  v_res := public.move_onboarding_stage(v_journey, v_target);
  IF (v_res->>'ok') <> 'true' THEN
    RAISE EXCEPTION 'com snapshot: item de outra demanda travou a etapa: %', v_res; END IF;

  -- Contraprova: na demanda A o MESMO item obrigatório TEM que travar.
  UPDATE public.onboarding_journeys SET current_stage_id = v_stage, demand_type_id = v_dt_a WHERE id = v_journey;
  DELETE FROM public.onboarding_journey_checklist WHERE journey_id = v_journey AND stage_id = v_stage;

  v_res := public.move_onboarding_stage(v_journey, v_target);
  IF (v_res->>'reason') <> 'checklist_incompleto' THEN
    RAISE EXCEPTION 'na demanda A o obrigatorio devia travar, veio %', v_res; END IF;

  RAISE NOTICE 'OK 32: gate por demanda nos dois caminhos';
END $$;

ROLLBACK;
