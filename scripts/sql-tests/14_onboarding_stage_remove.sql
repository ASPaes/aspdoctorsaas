-- Exclusão / arquivamento de etapa de onboarding (onboarding_stage_remove).
-- O ponto sutil: jornada ENCERRADA (concluído/cancelado) não aparece no quadro
-- mas continua apontando para a etapa e travando a FK. Ela não é movida.
-- Fixture sintética própria, tudo dentro da transação.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/14_onboarding_stage_remove.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_cliente uuid; v_unidade bigint; v_f1 bigint;
  v_ph_onb uuid; v_pipe uuid; v_pipe2 uuid;
  v_st_ini uuid; v_st_alvo uuid; v_st_rm uuid; v_st_virgem uuid; v_st_outro uuid; v_st_so_enc uuid;
  v_j1 uuid; v_j2 uuid; v_j3 uuid;
  v_res jsonb; v_qtd int;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- ===================== estrutura =====================
  SELECT count(*) INTO v_qtd FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='onboarding_stage_remove';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1: onboarding_stage_remove não existe (achei %)', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='onboarding_stage_remove' AND grantee='authenticated';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 2: falta GRANT EXECUTE para authenticated'; END IF;

  -- ===================== fixture =====================
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Stage Remove') RETURNING id INTO v_tenant;
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Imp', 'zz-imp-rm', true) RETURNING id INTO v_dept;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Ana', 'zz.ana.rm@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f1;
  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  VALUES (v_u1, v_tenant, 'admin', 'ativo', 'active', v_f1);

  SELECT public.fn_onboarding_phase_id(v_tenant,'onboarding') INTO v_ph_onb;

  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, ativo, position, department_id)
  VALUES (v_tenant, v_ph_onb, 'ZZ Pipe', true, 1, v_dept) RETURNING id INTO v_pipe;
  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, ativo, position, department_id)
  VALUES (v_tenant, v_ph_onb, 'ZZ Pipe 2', true, 2, v_dept) RETURNING id INTO v_pipe2;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe, 'ZZ Inicial', 'zz-ini', 1, true, false, true, ARRAY['checklist']) RETURNING id INTO v_st_ini;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe, 'ZZ Alvo', 'zz-alvo', 2, false, false, true, ARRAY['checklist']) RETURNING id INTO v_st_alvo;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe, 'ZZ Remover', 'zz-rm', 3, false, false, true, ARRAY['checklist']) RETURNING id INTO v_st_rm;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe, 'ZZ Virgem', 'zz-virgem', 4, false, true, true, ARRAY['checklist']) RETURNING id INTO v_st_virgem;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe, 'ZZ So Encerradas', 'zz-so-enc', 5, false, false, true, ARRAY['checklist']) RETURNING id INTO v_st_so_enc;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe2, 'ZZ Outro Pipe', 'zz-outro', 1, true, true, true, ARRAY['checklist']) RETURNING id INTO v_st_outro;

  SELECT COALESCE(max(id), 0) + 1 INTO v_unidade FROM public.unidades_base;
  INSERT INTO public.unidades_base (id, nome, tenant_id, is_active)
  VALUES (v_unidade, 'ZZ Un Rm', v_tenant, true);
  INSERT INTO public.clientes (tenant_id, nome_fantasia, razao_social, unidade_base_id)
  VALUES (v_tenant, 'ZZ Cli Rm', 'ZZ Cli Rm LTDA', v_unidade) RETURNING id INTO v_cliente;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role','authenticated')::text, true);

  v_j1 := public.create_onboarding_journey(v_tenant, v_cliente, 'ZZ Jornada 1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  v_j2 := public.create_onboarding_journey(v_tenant, v_cliente, 'ZZ Jornada 2', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  v_j3 := public.create_onboarding_journey(v_tenant, v_cliente, 'ZZ Jornada 3', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  -- j1 ativa e j2 encerrada param na etapa a remover; j3 encerrada fica sozinha noutra
  PERFORM public.move_onboarding_stage(v_j1, v_st_rm, '{}'::uuid[], true);
  PERFORM public.move_onboarding_stage(v_j2, v_st_rm, '{}'::uuid[], true);
  PERFORM public.move_onboarding_stage(v_j3, v_st_so_enc, '{}'::uuid[], true);
  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_j2;
  UPDATE public.onboarding_journeys SET situacao = 'cancelado' WHERE id = v_j3;

  SELECT count(*) INTO v_qtd FROM public.onboarding_journeys WHERE current_stage_id = v_st_rm;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 3: fixture deveria ter 2 jornadas na etapa, tem %', v_qtd; END IF;

  -- ===================== guardas =====================
  -- 4. etapa inicial é a porta de entrada do pipeline: nunca sai
  v_res := public.onboarding_stage_remove(v_st_ini, 'excluir', v_st_alvo);
  IF (v_res->>'reason') IS DISTINCT FROM 'etapa_inicial' THEN
    RAISE EXCEPTION 'FALHOU 4: esperava etapa_inicial, veio %', v_res::text;
  END IF;

  -- 5. modo inválido explode
  BEGIN
    v_res := public.onboarding_stage_remove(v_st_rm, 'apagar_tudo', v_st_alvo);
    RAISE EXCEPTION 'FALHOU 5: modo inválido deveria ter levantado exceção';
  EXCEPTION WHEN others THEN
    IF SQLERRM NOT LIKE '%modo invalido%' THEN RAISE; END IF;
  END;

  -- 6. destino obrigatório conta SÓ a jornada ativa (1 das 2), não a encerrada
  v_res := public.onboarding_stage_remove(v_st_rm, 'arquivar', NULL);
  IF (v_res->>'reason') IS DISTINCT FROM 'destino_obrigatorio' THEN
    RAISE EXCEPTION 'FALHOU 6: esperava destino_obrigatorio, veio %', v_res::text;
  END IF;
  IF (v_res->>'jornadas')::int <> 1 THEN
    RAISE EXCEPTION 'FALHOU 6b: deveria contar 1 jornada ativa (a encerrada não conta), veio %', v_res::text;
  END IF;

  -- 7. destino de outro pipeline não vale
  v_res := public.onboarding_stage_remove(v_st_rm, 'excluir', v_st_outro);
  IF (v_res->>'reason') IS DISTINCT FROM 'destino_invalido' THEN
    RAISE EXCEPTION 'FALHOU 7: esperava destino_invalido, veio %', v_res::text;
  END IF;

  -- 8. destino = a própria etapa não vale
  v_res := public.onboarding_stage_remove(v_st_rm, 'excluir', v_st_rm);
  IF (v_res->>'reason') IS DISTINCT FROM 'destino_invalido' THEN
    RAISE EXCEPTION 'FALHOU 8: esperava destino_invalido, veio %', v_res::text;
  END IF;

  -- 9. nenhuma guarda pode ter mexido em nada
  SELECT count(*) INTO v_qtd FROM public.onboarding_journeys WHERE current_stage_id = v_st_rm;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 9: guarda moveu cartão, sobrou %', v_qtd; END IF;

  -- ===================== arquivar =====================
  -- 10. arquivar move só a ativa; a encerrada fica onde parou
  v_res := public.onboarding_stage_remove(v_st_rm, 'arquivar', v_st_alvo);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 10: arquivar falhou: %', v_res::text; END IF;
  IF (v_res->>'movidas')::int <> 1 THEN RAISE EXCEPTION 'FALHOU 10b: esperava 1 movida, veio %', v_res::text; END IF;
  IF (v_res->>'encerradas_mantidas')::int <> 1 THEN RAISE EXCEPTION 'FALHOU 10c: esperava 1 encerrada mantida, veio %', v_res::text; END IF;

  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_j1 AND current_stage_id = v_st_alvo;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 11: jornada ativa não foi para o destino'; END IF;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_j2 AND current_stage_id = v_st_rm;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 11b: jornada encerrada não devia ter sido movida no arquivamento'; END IF;

  PERFORM 1 FROM public.onboarding_stages WHERE id = v_st_rm AND ativo = false;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 12: etapa arquivada deveria ficar com ativo=false'; END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_history WHERE stage_id = v_st_rm;
  IF v_qtd < 2 THEN RAISE EXCEPTION 'FALHOU 13: arquivar apagou histórico (sobrou %)', v_qtd; END IF;

  -- 14. a jornada encerrada continua encerrada
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_j2 AND situacao = 'concluido';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 14: jornada concluída mudou de situação'; END IF;

  -- ===================== excluir =====================
  -- devolve a etapa ao ar com a jornada ativa de volta para testar o destrutivo
  UPDATE public.onboarding_stages SET ativo = true WHERE id = v_st_rm;
  PERFORM public.move_onboarding_stage(v_j1, v_st_rm, '{}'::uuid[], true);

  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_history WHERE stage_id = v_st_rm;
  IF v_qtd < 3 THEN RAISE EXCEPTION 'FALHOU 15: fixture do excluir sem histórico (%)', v_qtd; END IF;

  v_res := public.onboarding_stage_remove(v_st_rm, 'excluir', v_st_alvo);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 16: excluir falhou: %', v_res::text; END IF;
  IF (v_res->>'movidas')::int <> 1 THEN RAISE EXCEPTION 'FALHOU 16b: esperava 1 movida, veio %', v_res::text; END IF;
  IF (v_res->>'encerradas_desvinculadas')::int <> 1 THEN RAISE EXCEPTION 'FALHOU 16c: esperava 1 desvinculada, veio %', v_res::text; END IF;
  IF (v_res->>'historico_apagado')::int < 3 THEN RAISE EXCEPTION 'FALHOU 16d: histórico apagado a menos: %', v_res::text; END IF;

  PERFORM 1 FROM public.onboarding_stages WHERE id = v_st_rm;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 17: etapa deveria ter sido apagada'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_history WHERE stage_id = v_st_rm;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 18: sobrou histórico órfão (%)', v_qtd; END IF;

  -- 19. a ativa foi pro destino; a encerrada ficou sem etapa, mas viva
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_j1 AND current_stage_id = v_st_alvo;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 19: jornada ativa deveria estar no destino'; END IF;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_j2 AND current_stage_id IS NULL AND situacao = 'concluido';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 19b: jornada encerrada deveria sobreviver sem etapa corrente'; END IF;

  -- ===================== etapa só com jornada encerrada =====================
  -- 20. sem cartão ativo, exclui sem exigir destino nenhum
  v_res := public.onboarding_stage_remove(v_st_so_enc, 'excluir', NULL);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 20: excluir etapa só com encerrada falhou: %', v_res::text; END IF;
  IF (v_res->>'encerradas_desvinculadas')::int <> 1 THEN RAISE EXCEPTION 'FALHOU 20b: esperava 1 desvinculada, veio %', v_res::text; END IF;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_j3 AND current_stage_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 20c: jornada cancelada deveria ter ficado sem etapa'; END IF;

  -- ===================== etapa nunca usada =====================
  -- 21. sem cartão e sem histórico, exclui direto
  v_res := public.onboarding_stage_remove(v_st_virgem, 'excluir', NULL);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 21: excluir etapa virgem falhou: %', v_res::text; END IF;
  PERFORM 1 FROM public.onboarding_stages WHERE id = v_st_virgem;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 21b: etapa virgem deveria ter sumido'; END IF;

  RAISE NOTICE 'OK — 21 asserções de onboarding_stage_remove passaram';
END $$;

ROLLBACK;
