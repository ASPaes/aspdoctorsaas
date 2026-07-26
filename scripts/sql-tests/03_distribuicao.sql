-- Asserções da distribuição justa do responsável inicial do onboarding.
-- Fixture sintética própria (tenant/setor/pessoas/pipeline/cliente), tudo dentro
-- da transação: não depende de dado real e não deixa rastro.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_distribuicao.sql
BEGIN;

DO $$
DECLARE
  v_qtd      int;
  v_tenant   uuid;
  v_dept     uuid;
  v_dept2    uuid;
  v_pipe     uuid;
  v_stage    uuid;
  v_cliente  uuid;
  v_journey  uuid;
  v_escolhido uuid;
  v_resp     uuid;
  v_ticket   uuid;
  v_tdept    uuid;
  v_f1 bigint; v_f2 bigint; v_f3 bigint; v_unidade bigint;
  v_pool     jsonb;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
  v_u2 uuid := '22222222-2222-2222-2222-222222222222';
  v_u3 uuid := '33333333-3333-3333-3333-333333333333';
BEGIN
  -- ========== 1. estrutura ==========
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_pipelines' AND column_name='department_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: onboarding_pipelines.department_id nao existe'; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_assignment_rules'
     AND column_name IN ('id','tenant_id','department_id','strategy','fixed_agent_id',
                         'excluded_agents','round_robin_last_index','is_active','created_at','updated_at');
  IF v_qtd <> 10 THEN RAISE EXCEPTION 'FALHOU 2: onboarding_assignment_rules tem % das 10 colunas', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_assignment_rules';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 3: esperava 4 policies, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_proc
   WHERE proname IN ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 4: esperava as 2 funcoes do motor, achei %', v_qtd; END IF;

  -- as duas RPCs precisam estar liberadas para o role authenticated
  SELECT count(DISTINCT routine_name) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND grantee='authenticated'
     AND routine_name IN ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 5: grant para authenticated faltando (achei % de 2)', v_qtd; END IF;

  -- ========== 2. fixture ==========
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Distribuicao') RETURNING id INTO v_tenant;

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Onboarding', 'zz-onboarding', true) RETURNING id INTO v_dept;

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Vazio', 'zz-vazio', true) RETURNING id INTO v_dept2;

  -- funcionário ativo exige email e setor (funcionario_require_email_and_department_when_active)
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Ana', 'zz.ana@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f1;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Bruno', 'zz.bruno@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f2;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Caio', 'zz.caio@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f3;

  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  -- u1 é 'admin' porque é ele quem "opera" no teste: prevent_profile_privilege_escalation
  -- barra um 'user' de alterar o profile de outra pessoa.
  VALUES (v_u1, v_tenant, 'admin', 'ativo', 'active', v_f1),
         (v_u2, v_tenant, 'user', 'ativo', 'active', v_f2),
         (v_u3, v_tenant, 'user', 'ativo', 'active', v_f3);

  -- trg_sync_funcionario_dept_to_members já pode ter criado essas linhas a partir
  -- de funcionarios.department_id — por isso o upsert em vez de INSERT puro.
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_u1, true),
         (v_tenant, v_dept, v_u2, true),
         (v_tenant, v_dept, v_u3, true)
  ON CONFLICT (tenant_id, department_id, user_id) DO UPDATE SET is_active = true;

  INSERT INTO public.onboarding_pipelines (tenant_id, fase, nome, ativo, position, department_id)
  VALUES (v_tenant, 'onboarding', 'ZZ Pipeline', true, 1, v_dept) RETURNING id INTO v_pipe;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, ativo)
  VALUES (v_tenant, v_pipe, 'ZZ Etapa 1', 'zz-etapa-1', 1, true, true) RETURNING id INTO v_stage;

  -- clientes exige unidade_base (clientes_unidade_base_obrigatoria); unidades_base.id
  -- não tem default, por isso o max()+1.
  SELECT COALESCE(max(id), 0) + 1 INTO v_unidade FROM public.unidades_base;
  INSERT INTO public.unidades_base (id, nome, tenant_id, is_active)
  VALUES (v_unidade, 'ZZ Unidade', v_tenant, true);

  INSERT INTO public.clientes (tenant_id, nome_fantasia, razao_social, unidade_base_id)
  VALUES (v_tenant, 'ZZ Cliente', 'ZZ Cliente LTDA', v_unidade) RETURNING id INTO v_cliente;

  -- usuário autenticado do tenant, para as RPCs passarem em can_access_tenant_row
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u1, 'role', 'authenticated')::text, true);

  -- ========== 3. menor_carga sem regra cadastrada ==========
  -- Ninguém tem jornada: empata em carga, empata em histórico, desempata por user_id.
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 6: sem regra deveria escolher u1 (menor carga, menor user_id), veio %', v_escolhido;
  END IF;

  -- ========== 4. criação de jornada sem implantador usa o motor ==========
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada 1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  SELECT responsavel_user_id, ticket_id INTO v_resp, v_ticket
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 7: jornada sem implantador deveria cair no rodizio (u1), veio %', v_resp;
  END IF;

  -- o setor do pipeline vai para o ticket
  SELECT department_id INTO v_tdept FROM public.support_tickets WHERE id = v_ticket;
  IF v_tdept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 8: ticket deveria herdar o setor do pipeline, veio %', v_tdept;
  END IF;

  -- histórico abre um período com motivo de distribuição automática
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_journey AND ate IS NULL AND user_id = v_u1 AND motivo ILIKE 'Distribui%';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 9: esperava 1 periodo aberto com motivo automatico, achei %', v_qtd; END IF;

  -- evento de auditoria
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_responsavel_auto';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 10: esperava 1 evento onboarding_responsavel_auto, achei %', v_qtd; END IF;

  -- ========== 5. a carga muda a próxima escolha ==========
  UPDATE public.onboarding_journeys SET situacao = 'em_andamento' WHERE id = v_journey;

  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_dept, NULL, 'onboarding');
  SELECT (m->>'jornadas_ativas')::int INTO v_qtd
    FROM jsonb_array_elements(v_pool->'membros') m WHERE (m->>'user_id')::uuid = v_u1;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 11: u1 deveria aparecer com 1 jornada ativa, veio %', v_qtd; END IF;

  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 12: com u1 ocupado deveria escolher u2, veio %', v_escolhido;
  END IF;

  -- jornada concluída deixa de contar como carga
  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_journey;
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_dept, NULL, 'onboarding');
  SELECT (m->>'jornadas_ativas')::int INTO v_qtd
    FROM jsonb_array_elements(v_pool->'membros') m WHERE (m->>'user_id')::uuid = v_u1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 15: jornada concluida nao deveria contar como carga, veio %', v_qtd; END IF;

  -- ...mas o desempate por "quem assumiu há mais tempo" mantém u1 atrás de quem
  -- nunca recebeu jornada nenhuma. Zerar a carga não devolve a vez na fila.
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 16: empate em carga deveria ir para quem nunca recebeu (u2), veio %', v_escolhido;
  END IF;

  UPDATE public.onboarding_journeys SET situacao = 'em_andamento' WHERE id = v_journey;

  -- ========== 6. membro fora do rodízio não é escolhido ==========
  INSERT INTO public.onboarding_assignment_rules (tenant_id, department_id, strategy, excluded_agents)
  VALUES (v_tenant, v_dept, 'menor_carga', ARRAY[v_u2]);

  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 15: com u1 ocupado e u2 fora do rodizio deveria escolher u3, veio %', v_escolhido;
  END IF;

  -- ========== 7. round_robin gira ==========
  UPDATE public.onboarding_assignment_rules
     SET strategy = 'round_robin', excluded_agents = '{}', round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND department_id = v_dept;

  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 16: round_robin deveria comecar em u1, veio %', v_escolhido;
  END IF;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 17: round_robin deveria girar para u2, veio %', v_escolhido;
  END IF;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 18: round_robin deveria girar para u3, veio %', v_escolhido;
  END IF;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 19: round_robin deveria voltar para u1, veio %', v_escolhido;
  END IF;

  -- ========== 8. estratégia fixo ==========
  UPDATE public.onboarding_assignment_rules
     SET strategy = 'fixo', fixed_agent_id = v_u3
   WHERE tenant_id = v_tenant AND department_id = v_dept;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 20: estrategia fixo deveria devolver u3, veio %', v_escolhido;
  END IF;

  -- agente fixo que saiu do setor cai para menor carga (u1 ocupado -> u2)
  UPDATE public.support_department_members SET is_active = false
   WHERE department_id = v_dept AND user_id = v_u3;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 21: agente fixo indisponivel deveria cair em menor carga (u2), veio %', v_escolhido;
  END IF;
  UPDATE public.support_department_members SET is_active = true
   WHERE department_id = v_dept AND user_id = v_u3;

  -- ========== 9. pessoa inativa sai do pool ==========
  UPDATE public.onboarding_assignment_rules SET strategy = 'menor_carga', fixed_agent_id = NULL
   WHERE tenant_id = v_tenant AND department_id = v_dept;
  UPDATE public.profiles SET status = 'inativo' WHERE user_id = v_u2;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept);
  IF v_escolhido IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 22: profile inativo deveria sair do pool, veio %', v_escolhido;
  END IF;
  UPDATE public.profiles SET status = 'ativo' WHERE user_id = v_u2;

  -- ========== 10. setor sem ninguém devolve NULL ==========
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_dept2);
  IF v_escolhido IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 23: setor vazio deveria devolver NULL, veio %', v_escolhido;
  END IF;

  -- setor nulo também
  IF public.fn_onboarding_pick_assignee(v_tenant, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 24: setor NULL deveria devolver NULL';
  END IF;

  -- ========== 11. escolha manual continua mandando ==========
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada 2', NULL, NULL, NULL, v_u3, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 25: implantador escolhido na mao deveria ser respeitado, veio %', v_resp;
  END IF;

  -- ========== 12. pipeline sem setor mantém o comportamento antigo (auth.uid) ==========
  UPDATE public.onboarding_pipelines SET department_id = NULL WHERE id = v_pipe;
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada 3', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 26: sem setor configurado deveria cair em auth.uid() = u1, veio %', v_resp;
  END IF;
  UPDATE public.onboarding_pipelines SET department_id = v_dept WHERE id = v_pipe;

  -- ========== 13. pool para a UI ==========
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_dept, NULL, 'onboarding');
  IF (v_pool->>'department_id')::uuid IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 27: pool deveria devolver o setor, veio %', v_pool->>'department_id';
  END IF;
  IF jsonb_array_length(v_pool->'membros') <> 3 THEN
    RAISE EXCEPTION 'FALHOU 28: pool deveria trazer 3 membros, veio %', jsonb_array_length(v_pool->'membros');
  END IF;
  IF NOT (v_pool->'membros'->0 ? 'jornadas_ativas') THEN
    RAISE EXCEPTION 'FALHOU 29: membro do pool deveria ter jornadas_ativas';
  END IF;
  IF NOT (v_pool->'membros'->0 ? 'nome') THEN
    RAISE EXCEPTION 'FALHOU 30: membro do pool deveria ter nome';
  END IF;

  -- resolvendo o setor pelo produto/fase, sem passar department_id
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, NULL, NULL, 'onboarding');
  IF (v_pool->>'department_id')::uuid IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 31: pool por fase deveria resolver o setor do pipeline, veio %', v_pool->>'department_id';
  END IF;

  -- membro fora do rodízio aparece marcado, não some da lista
  UPDATE public.onboarding_assignment_rules SET excluded_agents = ARRAY[v_u2]
   WHERE tenant_id = v_tenant AND department_id = v_dept;
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_dept, NULL, 'onboarding');
  SELECT count(*) INTO v_qtd FROM jsonb_array_elements(v_pool->'membros') m
   WHERE (m->>'no_rodizio')::boolean = false;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 32: esperava 1 membro fora do rodizio no pool, achei %', v_qtd; END IF;

  RAISE NOTICE 'OK: 03_distribuicao — 32 asserções passaram';
END $$;

ROLLBACK;
