-- Checklist por tipo de demanda (11/08): o vínculo do grupo decide o que a jornada enxerga.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/31_checklist_por_demanda.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_stage uuid; v_uid uuid;
  v_dt_a uuid; v_dt_b uuid; v_g_livre uuid; v_g_a uuid;
BEGIN
  SELECT j.id, j.tenant_id, j.current_stage_id INTO v_journey, v_tenant, v_stage
    FROM public.onboarding_journeys j
   WHERE j.current_stage_id IS NOT NULL AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em andamento com etapa'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin/head no tenant'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-A') RETURNING id INTO v_dt_a;
  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_tenant, 'TESTE-B') RETURNING id INTO v_dt_b;

  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE Livre', 90) RETURNING id INTO v_g_livre;
  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_tenant, v_stage, 'TESTE So A', 91) RETURNING id INTO v_g_a;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_a);

  -- a regra, nos 5 casos
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_livre, v_dt_b) THEN
    RAISE EXCEPTION 'grupo sem vinculo devia valer para qualquer demanda'; END IF;
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_a, v_dt_a) THEN
    RAISE EXCEPTION 'grupo vinculado devia valer na demanda dele'; END IF;
  IF public.fn_onb_checklist_grupo_aplica(v_g_a, v_dt_b) THEN
    RAISE EXCEPTION 'grupo vinculado a A NAO devia valer em B'; END IF;
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_a, NULL) THEN
    RAISE EXCEPTION 'jornada sem tipo de demanda nao deve filtrar nada'; END IF;
  IF NOT public.fn_onb_checklist_grupo_aplica(NULL, v_dt_b) THEN
    RAISE EXCEPTION 'item sem grupo devia valer sempre'; END IF;

  -- vínculo em 2 demandas vale nas 2
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_tenant, v_g_a, v_dt_b);
  IF NOT public.fn_onb_checklist_grupo_aplica(v_g_a, v_dt_b) THEN
    RAISE EXCEPTION 'grupo vinculado a A e B devia valer em B'; END IF;

  RAISE NOTICE 'OK 31 parte 1: regra do vinculo';
END $$;

-- RLS: usuário de um tenant não enxerga vínculo de outro.
DO $$
DECLARE
  v_t1 uuid; v_t2 uuid; v_stage uuid; v_g uuid; v_dt uuid; v_uid uuid; v_n int;
BEGIN
  SELECT s.tenant_id, s.id INTO v_t1, v_stage
    FROM public.onboarding_stages s WHERE s.ativo ORDER BY s.created_at LIMIT 1;
  SELECT t.id INTO v_t2 FROM public.tenants t WHERE t.id <> v_t1 LIMIT 1;
  IF v_t2 IS NULL THEN RAISE EXCEPTION 'PRE: base com um tenant só, teste de RLS impossível'; END IF;

  INSERT INTO public.onboarding_demand_types (tenant_id, nome) VALUES (v_t1, 'TESTE-RLS') RETURNING id INTO v_dt;
  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
    VALUES (v_t1, v_stage, 'TESTE RLS', 92) RETURNING id INTO v_g;
  INSERT INTO public.onboarding_checklist_group_demand_types (tenant_id, group_id, demand_type_id)
    VALUES (v_t1, v_g, v_dt);

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_t2 AND COALESCE(p.is_super_admin, false) = false LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: tenant vizinho sem usuário comum'; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  SELECT count(*) INTO v_n FROM public.onboarding_checklist_group_demand_types WHERE group_id = v_g;
  RESET role;

  IF v_n <> 0 THEN RAISE EXCEPTION 'vazamento: usuário do tenant vizinho leu % vínculo(s)', v_n; END IF;

  RAISE NOTICE 'OK 31 parte 2: RLS cross-tenant';
END $$;

ROLLBACK;
