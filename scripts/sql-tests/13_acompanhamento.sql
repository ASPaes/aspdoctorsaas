-- Asserções da Entrega C: avanço genérico de jornada, go-live configurável e indicadores.
-- Fixture sintética própria, tudo dentro da transação.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/13_acompanhamento.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_cliente uuid; v_journey uuid;
  v_ph_onb uuid; v_ph_imp uuid; v_ph_acp uuid;
  v_pipe_onb uuid; v_pipe_imp uuid; v_pipe_acp uuid;
  v_st_onb uuid; v_st_imp uuid; v_st_acp uuid;
  v_ind_vendas uuid; v_ind_fat uuid;
  v_f1 bigint; v_unidade bigint; v_qtd int; v_res jsonb; v_txt text;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- ===================== estrutura =====================
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_indicators'
     AND column_name IN ('id','tenant_id','nome','tipo','unidade','ativo','position','created_at','updated_at');
  IF v_qtd <> 9 THEN RAISE EXCEPTION 'FALHOU 1: onboarding_indicators tem % das 9 colunas', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_journey_indicators'
     AND column_name IN ('id','tenant_id','journey_id','indicator_id','data_ref','valor','observacao','origem','created_by','created_at','updated_at');
  IF v_qtd <> 11 THEN RAISE EXCEPTION 'FALHOU 2: onboarding_journey_indicators tem % das 11 colunas', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('onboarding_indicators','onboarding_journey_indicators')
     AND roles::text='{authenticated}';
  IF v_qtd <> 8 THEN RAISE EXCEPTION 'FALHOU 3: esperava 8 policies TO authenticated nas 2 tabelas, achei %', v_qtd; END IF;

  SELECT count(DISTINCT routine_name) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND grantee='authenticated'
     AND routine_name IN ('advance_onboarding_phase','journey_go_live','fn_onboarding_next_phase');
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 4: grant para authenticated faltando (achei % de 3)', v_qtd; END IF;

  -- ===================== fixture =====================
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Acompanhamento') RETURNING id INTO v_tenant;
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Imp', 'zz-imp-acp', true) RETURNING id INTO v_dept;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Ana', 'zz.ana.acp@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f1;
  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  VALUES (v_u1, v_tenant, 'admin', 'ativo', 'active', v_f1);

  SELECT public.fn_onboarding_phase_id(v_tenant,'onboarding')     INTO v_ph_onb;
  SELECT public.fn_onboarding_phase_id(v_tenant,'implantacao')    INTO v_ph_imp;
  SELECT public.fn_onboarding_phase_id(v_tenant,'acompanhamento') INTO v_ph_acp;

  -- Acompanhamento nasce desativada: é a Entrega C que liga.
  PERFORM 1 FROM public.onboarding_phases WHERE id = v_ph_acp AND ativo = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 5: acompanhamento deveria nascer inativa'; END IF;
  UPDATE public.onboarding_phases SET ativo = true WHERE id = v_ph_acp;

  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, ativo, position, department_id)
  VALUES (v_tenant, v_ph_onb, 'ZZ Onb', true, 1, v_dept) RETURNING id INTO v_pipe_onb;
  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, ativo, position, department_id)
  VALUES (v_tenant, v_ph_imp, 'ZZ Imp', true, 1, v_dept) RETURNING id INTO v_pipe_imp;
  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, ativo, position, department_id)
  VALUES (v_tenant, v_ph_acp, 'ZZ Acomp', true, 1, v_dept) RETURNING id INTO v_pipe_acp;

  -- 6. pipeline de fase fora do enum é aceito, com `fase` nula
  SELECT fase::text INTO v_txt FROM public.onboarding_pipelines WHERE id = v_pipe_acp;
  IF v_txt IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 6: fase deveria ser nula no pipeline de acompanhamento, achei %', v_txt; END IF;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe_onb, 'ZZ Onb 1', 'zz-onb-1', 1, true, true, true, ARRAY['checklist']) RETURNING id INTO v_st_onb;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe_imp, 'ZZ Imp 1', 'zz-imp-1', 1, true, true, true, ARRAY['checklist']) RETURNING id INTO v_st_imp;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe_acp, 'ZZ Acomp 1', 'zz-acp-1', 1, true, true, true, ARRAY['acompanhamento']) RETURNING id INTO v_st_acp;

  SELECT COALESCE(max(id), 0) + 1 INTO v_unidade FROM public.unidades_base;
  INSERT INTO public.unidades_base (id, nome, tenant_id, is_active)
  VALUES (v_unidade, 'ZZ Un Acomp', v_tenant, true);
  INSERT INTO public.clientes (tenant_id, nome_fantasia, razao_social, unidade_base_id)
  VALUES (v_tenant, 'ZZ Cli Acomp', 'ZZ Cli Acomp LTDA', v_unidade) RETURNING id INTO v_cliente;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role','authenticated')::text, true);

  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Acomp', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  -- ===================== avanço genérico =====================
  -- 7. a próxima fase de onboarding é implantação
  IF public.fn_onboarding_next_phase(v_journey) IS DISTINCT FROM v_ph_imp THEN
    RAISE EXCEPTION 'FALHOU 7: proxima fase de onboarding deveria ser implantacao';
  END IF;

  -- 8. avanço sem destino cai na próxima e delega para a RPC específica
  v_res := public.advance_onboarding_phase(v_journey, NULL, true);
  IF NOT (v_res->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 8: avanço para implantação falhou: %', v_res::text;
  END IF;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_journey AND current_phase_id = v_ph_imp;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8b: jornada deveria estar em implantacao'; END IF;

  -- 9. go-live SEMPRE conclui a jornada, mesmo com a jornada de Acompanhamento ativa.
  --    Mudou em 01/08: acompanhamento deixou de ser fase para onde o cartão avança e virou
  --    ticket próprio (migration 20260731224000). A fase existir não segura mais a implantação.
  v_res := public.journey_go_live(v_journey, current_date);
  IF NOT (v_res->>'concluiu')::boolean THEN
    RAISE EXCEPTION 'FALHOU 9: go-live deveria concluir a jornada → %', v_res::text;
  END IF;
  PERFORM 1 FROM public.onboarding_journeys
   WHERE id = v_journey AND situacao = 'concluido' AND concluido_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 9b: jornada deveria estar concluída'; END IF;

  -- 10. o go-live fecha a implantação e NÃO abre fase nenhuma: desde 01/08 o acompanhamento
  --     é ticket próprio, então a jornada morre aqui.
  PERFORM 1 FROM public.onboarding_phase_metrics WHERE journey_id=v_journey AND phase_id=v_ph_imp AND concluida_em IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 10a: fase de implantação não fechou'; END IF;
  PERFORM 1 FROM public.onboarding_phase_metrics WHERE journey_id=v_journey AND concluida_em IS NULL;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 10b: jornada concluída não pode ter fase aberta'; END IF;

  -- 11. jornada concluída não avança para lugar nenhum
  v_res := public.advance_onboarding_phase(v_journey, NULL, true);
  IF (v_res->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 11: jornada concluída não deveria avançar → %', v_res::text;
  END IF;

  -- ===================== indicadores =====================
  INSERT INTO public.onboarding_indicators (tenant_id, nome, tipo, unidade, position)
  VALUES (v_tenant, 'Nº de vendas', 'numero', 'un', 1) RETURNING id INTO v_ind_vendas;
  INSERT INTO public.onboarding_indicators (tenant_id, nome, tipo, unidade, position)
  VALUES (v_tenant, 'Faturamento', 'moeda', 'R$', 2) RETURNING id INTO v_ind_fat;

  -- 12. coletas em datas irregulares (a decisão foi data livre)
  INSERT INTO public.onboarding_journey_indicators (tenant_id, journey_id, indicator_id, data_ref, valor, created_by)
  VALUES (v_tenant, v_journey, v_ind_vendas, current_date - 21, '18',  v_u1),
         (v_tenant, v_journey, v_ind_vendas, current_date - 14, '64',  v_u1),
         (v_tenant, v_journey, v_ind_vendas, current_date,      '142', v_u1),
         (v_tenant, v_journey, v_ind_fat,    current_date,      '38400', v_u1);
  SELECT count(*) INTO v_qtd FROM public.onboarding_journey_indicators WHERE journey_id = v_journey;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 12: esperava 4 coletas, achei %', v_qtd; END IF;

  -- 13. origem nasce 'manual', pronta para import/api sem migração
  PERFORM 1 FROM public.onboarding_journey_indicators WHERE journey_id=v_journey AND origem='manual' LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 13: origem deveria nascer manual'; END IF;

  -- 14. lançamento duplicado no mesmo dia é rejeitado
  BEGIN
    INSERT INTO public.onboarding_journey_indicators (tenant_id, journey_id, indicator_id, data_ref, valor)
    VALUES (v_tenant, v_journey, v_ind_vendas, current_date, '999');
    RAISE EXCEPTION 'FALHOU 14: duplicado deveria violar a unique';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 15. tipo fora da lista é rejeitado
  BEGIN
    INSERT INTO public.onboarding_indicators (tenant_id, nome, tipo) VALUES (v_tenant, 'ZZ Errado', 'planilha');
    RAISE EXCEPTION 'FALHOU 15: tipo inválido deveria violar o CHECK';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 16. coleta com tenant divergente da jornada é barrada (vazamento entre empresas)
  BEGIN
    INSERT INTO public.onboarding_journey_indicators (tenant_id, journey_id, indicator_id, data_ref, valor)
    VALUES ('a0000000-0000-0000-0000-000000000001', v_journey, v_ind_vendas, current_date - 1, '1');
    RAISE EXCEPTION 'FALHOU 16: tenant divergente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 17. concluir a jornada no fim do acompanhamento fecha tudo
  PERFORM public.conclude_onboarding_journey(v_journey, NULL);
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_journey AND concluida_em IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 17: sobrou % fase aberta depois de concluir', v_qtd; END IF;

  RAISE NOTICE 'OK: 13_acompanhamento — 17 asserções passaram';
END $$;

ROLLBACK;
