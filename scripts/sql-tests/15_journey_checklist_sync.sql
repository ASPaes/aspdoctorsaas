-- sync_journey_stage_checklist: o checklist do cartão tem que refletir o cadastro
-- mesmo quando o cadastro muda DEPOIS que a jornada já entrou na etapa.
-- Estado (done/done_at/done_by) é da jornada; definição (texto, obrigatoriedade,
-- ordem, grupo) é do cadastro. Item manual não é tocado.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/15_journey_checklist_sync.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_dept uuid; v_cliente uuid; v_unidade bigint; v_f1 bigint;
  v_ph_onb uuid; v_pipe uuid; v_stage uuid;
  v_g1 uuid; v_i1 uuid; v_i2 uuid; v_i3 uuid;
  v_j uuid; v_qtd int; v_rec record;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
BEGIN
  -- ===================== estrutura =====================
  SELECT count(*) INTO v_qtd FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='sync_journey_stage_checklist';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1: sync_journey_stage_checklist não existe (achei %)', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='sync_journey_stage_checklist' AND grantee='authenticated';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 2: falta GRANT EXECUTE para authenticated'; END IF;

  -- ===================== fixture =====================
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Checklist Sync') RETURNING id INTO v_tenant;
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Imp', 'zz-imp-cks', true) RETURNING id INTO v_dept;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Ana', 'zz.ana.cks@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f1;
  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  VALUES (v_u1, v_tenant, 'admin', 'ativo', 'active', v_f1);

  SELECT public.fn_onboarding_phase_id(v_tenant,'onboarding') INTO v_ph_onb;

  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, ativo, position, department_id)
  VALUES (v_tenant, v_ph_onb, 'ZZ Pipe CKS', true, 1, v_dept) RETURNING id INTO v_pipe;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, is_final, ativo, visible_sections)
  VALUES (v_tenant, v_pipe, 'ZZ Etapa', 'zz-etapa-cks', 1, true, false, true, ARRAY['checklist']) RETURNING id INTO v_stage;

  -- cadastro: 1 grupo com 2 itens, ambos obrigatórios
  INSERT INTO public.onboarding_stage_checklist_groups (tenant_id, stage_id, nome, position)
  VALUES (v_tenant, v_stage, 'ZZ Grupo A', 1) RETURNING id INTO v_g1;
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position, ativo)
  VALUES (v_tenant, v_stage, v_g1, 'ZZ Item 1', true, 1, true) RETURNING id INTO v_i1;
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position, ativo)
  VALUES (v_tenant, v_stage, v_g1, 'ZZ Item 2', true, 2, true) RETURNING id INTO v_i2;

  SELECT COALESCE(max(id), 0) + 1 INTO v_unidade FROM public.unidades_base;
  INSERT INTO public.unidades_base (id, nome, tenant_id, is_active)
  VALUES (v_unidade, 'ZZ Un Cks', v_tenant, true);
  INSERT INTO public.clientes (tenant_id, nome_fantasia, razao_social, unidade_base_id)
  VALUES (v_tenant, 'ZZ Cli Cks', 'ZZ Cli Cks LTDA', v_unidade) RETURNING id INTO v_cliente;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_u1, 'role','authenticated')::text, true);

  v_j := public.create_onboarding_journey(v_tenant, v_cliente, 'ZZ Jornada CKS', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  UPDATE public.onboarding_journeys SET current_stage_id = v_stage WHERE id = v_j;

  -- primeira materialização: o cartão nasce espelhando o cadastro
  PERFORM * FROM public.sync_journey_stage_checklist(v_j, v_stage);

  SELECT count(*) INTO v_qtd FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND stage_id = v_stage;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 3: snapshot inicial deveria ter 2 itens, tem %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND is_required = true;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 4: os 2 itens deveriam nascer obrigatórios, achei %', v_qtd; END IF;

  -- o operador marca o Item 1 como feito e cria um item manual só dele
  UPDATE public.onboarding_journey_checklist
     SET done = true, done_at = now(), done_by = v_u1
   WHERE journey_id = v_j AND source_item_id = v_i1;

  INSERT INTO public.onboarding_journey_checklist
    (tenant_id, journey_id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem)
  VALUES (v_tenant, v_j, v_stage, 'ZZ Grupo A', 1, 'ZZ Item manual', true, 99, 'manual');

  -- ===================== o cadastro muda DEPOIS =====================
  UPDATE public.onboarding_stage_checklist
     SET is_required = false, texto = 'ZZ Item 1 EDITADO', position = 5
   WHERE id = v_i1;
  UPDATE public.onboarding_stage_checklist_groups
     SET nome = 'ZZ Grupo A EDITADO', position = 7
   WHERE id = v_g1;
  DELETE FROM public.onboarding_stage_checklist WHERE id = v_i2;
  INSERT INTO public.onboarding_stage_checklist (tenant_id, stage_id, group_id, texto, is_required, position, ativo)
  VALUES (v_tenant, v_stage, v_g1, 'ZZ Item 3', true, 6, true) RETURNING id INTO v_i3;

  PERFORM * FROM public.sync_journey_stage_checklist(v_j, v_stage);

  -- 5. o item editado passa a refletir o cadastro — e continua feito
  SELECT * INTO v_rec FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND source_item_id = v_i1;
  IF v_rec.is_required <> false THEN
    RAISE EXCEPTION 'FALHOU 5: item desmarcado no cadastro continua obrigatório no cartão';
  END IF;
  IF v_rec.texto <> 'ZZ Item 1 EDITADO' THEN
    RAISE EXCEPTION 'FALHOU 5b: texto não acompanhou o cadastro (veio %)', v_rec.texto;
  END IF;
  IF v_rec.position <> 5 THEN
    RAISE EXCEPTION 'FALHOU 5c: ordem não acompanhou o cadastro (veio %)', v_rec.position;
  END IF;
  IF v_rec.grupo_nome <> 'ZZ Grupo A EDITADO' OR v_rec.grupo_pos <> 7 THEN
    RAISE EXCEPTION 'FALHOU 5d: grupo não acompanhou o cadastro (% / %)', v_rec.grupo_nome, v_rec.grupo_pos;
  END IF;
  IF v_rec.done <> true OR v_rec.done_at IS NULL OR v_rec.done_by <> v_u1 THEN
    RAISE EXCEPTION 'FALHOU 5e: sincronizar apagou o que já tinha sido marcado como feito';
  END IF;

  -- 6. item excluído do cadastro permanece no cartão (decisão do owner)
  SELECT count(*) INTO v_qtd FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND source_item_id = v_i2;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6: item removido do cadastro sumiu do cartão (achei %)', v_qtd; END IF;

  SELECT * INTO v_rec FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND source_item_id = v_i2;
  IF v_rec.texto <> 'ZZ Item 2' THEN
    RAISE EXCEPTION 'FALHOU 6b: item órfão foi alterado (veio %)', v_rec.texto;
  END IF;

  -- 7. item novo do cadastro entra no cartão
  SELECT * INTO v_rec FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND source_item_id = v_i3;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: item novo do cadastro não entrou no cartão'; END IF;
  IF v_rec.is_required <> true OR v_rec.texto <> 'ZZ Item 3' THEN
    RAISE EXCEPTION 'FALHOU 7b: item novo entrou errado (% / %)', v_rec.texto, v_rec.is_required;
  END IF;
  IF v_rec.grupo_nome <> 'ZZ Grupo A EDITADO' THEN
    RAISE EXCEPTION 'FALHOU 7c: item novo veio com grupo errado (%)', v_rec.grupo_nome;
  END IF;

  -- 8. item manual é da jornada, o cadastro não manda nele
  SELECT * INTO v_rec FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND origem = 'manual';
  IF v_rec.is_required <> true OR v_rec.texto <> 'ZZ Item manual' OR v_rec.position <> 99 THEN
    RAISE EXCEPTION 'FALHOU 8: sincronizar mexeu no item manual (% / % / %)', v_rec.texto, v_rec.is_required, v_rec.position;
  END IF;

  -- 9. nada duplicou
  SELECT count(*) INTO v_qtd FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND stage_id = v_stage;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 9: esperava 4 linhas no cartão, achei %', v_qtd; END IF;

  -- 10. sincronizar de novo é idempotente
  PERFORM * FROM public.sync_journey_stage_checklist(v_j, v_stage);
  SELECT count(*) INTO v_qtd FROM public.onboarding_journey_checklist
   WHERE journey_id = v_j AND stage_id = v_stage;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 10: segunda sincronização duplicou (achei %)', v_qtd; END IF;

  RAISE NOTICE 'OK — 10 asserções de sync_journey_stage_checklist passaram';
END $$;

ROLLBACK;
