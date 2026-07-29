-- Asserções da Task 5 (Entrega A): a linha da fase existe enquanto a fase está aberta.
-- Fixture sintética própria, tudo dentro da transação (mesmo padrão de 03_distribuicao).
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/11_onboarding_phase_row_viva.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_cliente uuid; v_journey uuid;
  v_pipe_onb uuid; v_pipe_imp uuid; v_st_onb uuid; v_st_imp uuid;
  v_ph_onb uuid; v_ph_imp uuid;
  v_f1 bigint; v_unidade bigint; v_qtd int;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- ========== 1. backfill: toda jornada aberta já tem a linha da fase atual ==========
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_journeys j
   WHERE j.current_phase_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_phase_metrics m
                      WHERE m.journey_id = j.id AND m.phase_id = j.current_phase_id);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 1: % jornada(s) aberta(s) sem linha da fase atual', v_qtd; END IF;

  -- ========== fixture ==========
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Fase Viva') RETURNING id INTO v_tenant;

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Implantacao', 'zz-implantacao', true) RETURNING id INTO v_dept;

  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Ana', 'zz.ana.fase@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f1;

  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  VALUES (v_u1, v_tenant, 'admin', 'ativo', 'active', v_f1);

  SELECT public.fn_onboarding_phase_id(v_tenant,'onboarding')  INTO v_ph_onb;
  SELECT public.fn_onboarding_phase_id(v_tenant,'implantacao') INTO v_ph_imp;
  IF v_ph_onb IS NULL OR v_ph_imp IS NULL THEN
    RAISE EXCEPTION 'PRE: tenant novo não recebeu as fases-semente';
  END IF;

  INSERT INTO public.onboarding_pipelines (tenant_id, fase, nome, ativo, position, department_id)
  VALUES (v_tenant, 'onboarding', 'ZZ Pipe Onb', true, 1, v_dept) RETURNING id INTO v_pipe_onb;
  INSERT INTO public.onboarding_pipelines (tenant_id, fase, nome, ativo, position, department_id)
  VALUES (v_tenant, 'implantacao', 'ZZ Pipe Imp', true, 1, v_dept) RETURNING id INTO v_pipe_imp;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo)
  VALUES (v_tenant, v_pipe_onb, 'ZZ Onb 1', 'zz-onb-1', 1, true, true, true) RETURNING id INTO v_st_onb;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo)
  VALUES (v_tenant, v_pipe_imp, 'ZZ Imp 1', 'zz-imp-1', 1, true, true, true) RETURNING id INTO v_st_imp;

  SELECT COALESCE(max(id), 0) + 1 INTO v_unidade FROM public.unidades_base;
  INSERT INTO public.unidades_base (id, nome, tenant_id, is_active)
  VALUES (v_unidade, 'ZZ Unidade Fase', v_tenant, true);

  INSERT INTO public.clientes (tenant_id, nome_fantasia, razao_social, unidade_base_id)
  VALUES (v_tenant, 'ZZ Cliente Fase', 'ZZ Cliente Fase LTDA', v_unidade) RETURNING id INTO v_cliente;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);

  -- ========== 2. jornada nova nasce com a linha da primeira fase aberta ==========
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Fase Viva', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_onb
     AND concluida_em IS NULL AND iniciada_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 2: jornada nova não abriu a linha da fase onboarding'; END IF;

  -- ========== 3. avançar fecha a linha de onboarding e abre a de implantação ==========
  PERFORM public.advance_onboarding_to_implantacao(v_journey, true);

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_onb AND concluida_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 3a: linha de onboarding não foi fechada'; END IF;

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_imp AND concluida_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 3b: linha de implantação não foi aberta'; END IF;

  -- ========== 4. o pipeline percorrido ficou registrado na linha ==========
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics m
    JOIN public.onboarding_pipelines p ON p.id = m.pipeline_id
   WHERE m.journey_id = v_journey AND m.phase_id = v_ph_imp AND p.phase_id = v_ph_imp;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4: pipeline_id ausente ou de outra fase na linha de implantação'; END IF;

  -- ========== 5. nunca há duas linhas abertas na mesma jornada ==========
  SELECT count(*) INTO v_qtd FROM (
    SELECT journey_id FROM public.onboarding_phase_metrics
     WHERE concluida_em IS NULL GROUP BY journey_id HAVING count(*) > 1) x;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % jornada(s) com mais de uma fase aberta', v_qtd; END IF;

  -- ========== 6. reverter reabre a fase de onboarding e fecha a de implantação ==========
  PERFORM public.revert_onboarding_to_onboarding(v_journey);

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_onb AND concluida_em IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 6a: reverter deveria reabrir a fase de onboarding'; END IF;

  PERFORM 1 FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND phase_id = v_ph_imp AND concluida_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 6b: reverter deveria fechar a fase de implantação'; END IF;

  -- ========== 7. concluir a jornada fecha a fase aberta ==========
  PERFORM public.advance_onboarding_to_implantacao(v_journey, true);
  PERFORM public.conclude_onboarding_journey(v_journey, current_date);

  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND concluida_em IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 7: sobrou % fase aberta depois de concluir', v_qtd; END IF;

  RAISE NOTICE 'OK: 11_onboarding_phase_row_viva — 7 asserções passaram';
END $$;

ROLLBACK;
