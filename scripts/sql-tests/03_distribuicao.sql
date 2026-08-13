-- Asserções da distribuição justa do responsável inicial do onboarding.
-- Fixture sintética própria (tenant/setor/pessoas/pipelines/cliente), tudo dentro
-- da transação: não depende de dado real e não deixa rastro.
--
-- Desde 13/08/2026 a regra de distribuição é por PIPELINE, não por setor:
-- onboarding_assignment_rules.pipeline_id + included_agents (lista explícita e
-- ordenada de quem participa, que pode incluir gente de outro setor).
--
-- Rodar (schema já migrado):
--   docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/03_distribuicao.sql
-- Rodar junto com a migration, sem persistir nada:
--   scripts/sql-tests/run-com-migration.sh <migration.sql> scripts/sql-tests/03_distribuicao.sql
BEGIN;

DO $$
DECLARE
  v_qtd      int;
  v_tenant   uuid;
  v_dept     uuid;
  v_dept2    uuid;
  v_dept3    uuid;
  v_pipe     uuid;
  v_pipe_b   uuid;
  v_stage    uuid;
  v_stage_b  uuid;
  v_cliente  uuid;
  v_journey  uuid;
  v_escolhido uuid;
  v_resp     uuid;
  v_ticket   uuid;
  v_tdept    uuid;
  v_f1 bigint; v_f2 bigint; v_f3 bigint; v_f4 bigint; v_unidade bigint;
  v_pool     jsonb;
  v_u1 uuid := '11111111-1111-1111-1111-111111111111';
  v_u2 uuid := '22222222-2222-2222-2222-222222222222';
  v_u3 uuid := '33333333-3333-3333-3333-333333333333';
  v_u4 uuid := '44444444-4444-4444-4444-444444444444';
BEGIN
  -- ========== 1. estrutura ==========
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_pipelines' AND column_name='department_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: onboarding_pipelines.department_id nao existe'; END IF;

  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_assignment_rules'
     AND column_name IN ('id','tenant_id','pipeline_id','strategy','fixed_agent_id',
                         'included_agents','round_robin_last_index','is_active','created_at','updated_at');
  IF v_qtd <> 10 THEN RAISE EXCEPTION 'FALHOU 2: onboarding_assignment_rules tem % das 10 colunas', v_qtd; END IF;

  -- as colunas do modelo por setor precisam ter sumido: enquanto existirem, alguém
  -- ainda consegue gravar regra por setor e o motor passa a ter duas fontes.
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_assignment_rules'
     AND column_name IN ('department_id','excluded_agents');
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: colunas do modelo por setor ainda existem (%)', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_constraint
   WHERE conrelid = 'public.onboarding_assignment_rules'::regclass AND contype = 'u'
     AND pg_get_constraintdef(oid) ILIKE '%(tenant_id, pipeline_id)%';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4: falta a UNIQUE (tenant_id, pipeline_id)'; END IF;

  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_assignment_rules';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 5: esperava 4 policies, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM pg_proc
   WHERE proname IN ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 6: esperava as 2 funcoes do motor, achei %', v_qtd; END IF;

  -- as duas RPCs precisam continuar liberadas para authenticated DEPOIS do DROP/CREATE:
  -- DROP FUNCTION leva os grants junto e o erro só aparece no frontend, como RPC nula.
  SELECT count(DISTINCT routine_name) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND grantee='authenticated'
     AND routine_name IN ('fn_onboarding_pick_assignee','fn_onboarding_assignment_pool');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 7: grant para authenticated faltando (achei % de 2)', v_qtd; END IF;

  -- o motor precisa continuar com a guarda cross-tenant de 31/07
  PERFORM 1 FROM pg_proc WHERE proname='fn_onboarding_pick_assignee'
     AND pg_get_functiondef(oid) LIKE '%assert_tenant_scope%';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8: fn_onboarding_pick_assignee perdeu o assert_tenant_scope'; END IF;

  -- ========== 2. fixture ==========
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Distribuicao') RETURNING id INTO v_tenant;

  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Onboarding', 'zz-onboarding', true) RETURNING id INTO v_dept;

  -- setor que fica VAZIO de propósito (asserção do pipeline sem ninguém)
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Vazio', 'zz-vazio', true) RETURNING id INTO v_dept2;

  -- setor de onde vem a pessoa que participa de um pipeline sem ser do setor dele:
  -- é o caso do "Fabricio Onboarding" (Suporte Gula) no rodízio do Onboarding Gula.
  INSERT INTO public.support_departments (tenant_id, name, slug, is_active)
  VALUES (v_tenant, 'ZZ Outro Setor', 'zz-outro', true) RETURNING id INTO v_dept3;

  -- funcionário ativo exige email e setor (funcionario_require_email_and_department_when_active)
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Ana', 'zz.ana@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f1;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Bruno', 'zz.bruno@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f2;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Caio', 'zz.caio@teste.local', v_tenant, true, v_dept) RETURNING id INTO v_f3;
  INSERT INTO public.funcionarios (nome, email, tenant_id, ativo, department_id)
  VALUES ('ZZ Dora', 'zz.dora@teste.local', v_tenant, true, v_dept3) RETURNING id INTO v_f4;

  INSERT INTO public.profiles (user_id, tenant_id, role, status, access_status, funcionario_id)
  -- u1 é 'admin' porque é ele quem "opera" no teste: prevent_profile_privilege_escalation
  -- barra um 'user' de alterar o profile de outra pessoa.
  VALUES (v_u1, v_tenant, 'admin', 'ativo', 'active', v_f1),
         (v_u2, v_tenant, 'user', 'ativo', 'active', v_f2),
         (v_u3, v_tenant, 'user', 'ativo', 'active', v_f3),
         (v_u4, v_tenant, 'user', 'ativo', 'active', v_f4);

  -- trg_sync_funcionario_dept_to_members já pode ter criado essas linhas a partir
  -- de funcionarios.department_id — por isso o upsert em vez de INSERT puro.
  INSERT INTO public.support_department_members (tenant_id, department_id, user_id, is_active)
  VALUES (v_tenant, v_dept, v_u1, true),
         (v_tenant, v_dept, v_u2, true),
         (v_tenant, v_dept, v_u3, true),
         (v_tenant, v_dept3, v_u4, true)
  ON CONFLICT (tenant_id, department_id, user_id) DO UPDATE SET is_active = true;

  -- u4 não pode estar no setor do pipeline A: é justamente isso que a lista
  -- explícita precisa vencer.
  DELETE FROM public.support_department_members
   WHERE tenant_id = v_tenant AND department_id = v_dept AND user_id = v_u4;

  INSERT INTO public.onboarding_pipelines (tenant_id, fase, nome, ativo, position, department_id)
  VALUES (v_tenant, 'onboarding', 'ZZ Pipeline', true, 1, v_dept) RETURNING id INTO v_pipe;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, ativo)
  VALUES (v_tenant, v_pipe, 'ZZ Etapa 1', 'zz-etapa-1', 1, true, true) RETURNING id INTO v_stage;

  -- segundo pipeline no MESMO setor: é o caso "Onboarding PDV" x "Onboarding Gula".
  -- position 2 para que create_onboarding_journey continue escolhendo o pipeline A.
  INSERT INTO public.onboarding_pipelines (tenant_id, fase, nome, ativo, position, department_id)
  VALUES (v_tenant, 'onboarding', 'ZZ Pipeline B', true, 2, v_dept) RETURNING id INTO v_pipe_b;

  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, ativo)
  VALUES (v_tenant, v_pipe_b, 'ZZ Etapa B1', 'zz-etapa-b1', 1, true, true) RETURNING id INTO v_stage_b;

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

  -- ========== 3. sem regra: cai no SETOR do pipeline, menor_carga ==========
  -- É o fallback que impede um tenant sem configuração de criar jornada órfã.
  -- Ninguém tem jornada: empata em carga, empata em histórico, desempata por user_id.
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 9: sem regra deveria escolher u1 (menor carga, menor user_id), veio %', v_escolhido;
  END IF;

  -- e o fallback é o SETOR, nunca o tenant inteiro: u4 é de outro setor
  IF v_escolhido = v_u4 THEN
    RAISE EXCEPTION 'FALHOU 10: fallback pegou alguem de fora do setor do pipeline';
  END IF;

  -- ========== 4. lista explícita manda, inclusive com gente de fora do setor ==========
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, round_robin_last_index, is_active)
  VALUES (v_tenant, v_pipe_b, 'round_robin', ARRAY[v_u4], -1, true);

  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b);
  IF v_escolhido IS DISTINCT FROM v_u4 THEN
    RAISE EXCEPTION 'FALHOU 11: pipeline B deveria escolher u4 (fora do setor), veio %', v_escolhido;
  END IF;

  -- os dois pipelines não se contaminam: A continua no setor, B na lista dele
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido = v_u4 THEN
    RAISE EXCEPTION 'FALHOU 12: pipeline A pegou o participante exclusivo do B';
  END IF;

  -- ========== 5. o ciclo do rodízio é por pipeline ==========
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, round_robin_last_index, is_active)
  VALUES (v_tenant, v_pipe, 'round_robin', ARRAY[v_u1, v_u2, v_u3], -1, true);

  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 13: 1a volta do rodizio de A deveria ser u1';
  END IF;
  -- girar o B no meio não pode mexer no índice do A
  PERFORM public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b);
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 14: o rodizio de B moveu o indice do A';
  END IF;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 15: round_robin deveria girar para u3';
  END IF;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 16: round_robin deveria voltar para u1';
  END IF;

  -- ========== 6. a ordem do rodízio é a do array, não a do user_id ==========
  UPDATE public.onboarding_assignment_rules
     SET included_agents = ARRAY[v_u3, v_u1], round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 17: rodizio deveria seguir a ordem do array (u3 primeiro)';
  END IF;

  -- ========== 7. participante inativo sai do pool sem quebrar o rodízio ==========
  UPDATE public.profiles SET status = 'inativo' WHERE user_id = v_u3 AND tenant_id = v_tenant;
  UPDATE public.onboarding_assignment_rules SET round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 18: participante inativo deveria sair do pool';
  END IF;
  UPDATE public.profiles SET status = 'ativo' WHERE user_id = v_u3 AND tenant_id = v_tenant;

  -- ========== 8. estratégia fixo ==========
  UPDATE public.onboarding_assignment_rules
     SET strategy = 'fixo', fixed_agent_id = v_u3, included_agents = ARRAY[v_u1, v_u2, v_u3]
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 19: estrategia fixo deveria devolver u3, veio %', v_escolhido;
  END IF;

  -- agente fixo que saiu da lista cai para menor carga (ninguém tem jornada: u1)
  UPDATE public.onboarding_assignment_rules
     SET included_agents = ARRAY[v_u1, v_u2]
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 20: agente fixo fora da lista deveria cair em menor carga (u1), veio %', v_escolhido;
  END IF;

  -- agente fixo que saiu do SETOR também cai, no caminho do fallback
  UPDATE public.onboarding_assignment_rules
     SET included_agents = '{}', fixed_agent_id = v_u3
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  UPDATE public.support_department_members SET is_active = false
   WHERE department_id = v_dept AND user_id = v_u3;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 21: agente fixo fora do setor deveria cair em menor carga (u1), veio %', v_escolhido;
  END IF;
  UPDATE public.support_department_members SET is_active = true
   WHERE department_id = v_dept AND user_id = v_u3;

  -- ========== 9. lista vazia volta para o setor, mantendo a estratégia ==========
  -- Forçar menor_carga aqui faria a tela mostrar "Rodízio" e o motor fazer outra coisa.
  UPDATE public.onboarding_assignment_rules
     SET strategy = 'round_robin', fixed_agent_id = NULL,
         included_agents = '{}', round_robin_last_index = -1
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe;
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 22: lista vazia deveria girar o rodizio sobre o setor (u1), veio %', v_escolhido;
  END IF;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe) IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 23: o rodizio sobre o setor deveria girar para u2';
  END IF;

  -- ========== 10. pipeline sem candidato devolve NULL ==========
  -- setor vazio
  UPDATE public.onboarding_pipelines SET department_id = v_dept2 WHERE id = v_pipe_b;
  UPDATE public.onboarding_assignment_rules SET included_agents = '{}'
   WHERE tenant_id = v_tenant AND pipeline_id = v_pipe_b;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 24: pipeline com setor vazio deveria devolver NULL';
  END IF;

  -- sem setor E sem lista
  UPDATE public.onboarding_pipelines SET department_id = NULL WHERE id = v_pipe_b;
  IF public.fn_onboarding_pick_assignee(v_tenant, v_pipe_b) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 25: pipeline sem setor e sem lista deveria devolver NULL';
  END IF;
  UPDATE public.onboarding_pipelines SET department_id = v_dept WHERE id = v_pipe_b;

  -- pipeline nulo também
  IF public.fn_onboarding_pick_assignee(v_tenant, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 26: pipeline NULL deveria devolver NULL';
  END IF;

  -- estado conhecido para as seções de criação de jornada
  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;

  -- ========== 11. criação de jornada sem implantador usa o motor ==========
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada 1', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

  SELECT responsavel_user_id, ticket_id INTO v_resp, v_ticket
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 27: jornada sem implantador deveria cair no rodizio (u1), veio %', v_resp;
  END IF;

  -- o setor do pipeline vai para o ticket
  SELECT department_id INTO v_tdept FROM public.support_tickets WHERE id = v_ticket;
  IF v_tdept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 28: ticket deveria herdar o setor do pipeline, veio %', v_tdept;
  END IF;

  -- histórico abre um período com motivo de distribuição automática, citando o pipeline
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_journey AND ate IS NULL AND user_id = v_u1 AND motivo ILIKE 'Distribui%';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 29: esperava 1 periodo aberto com motivo automatico, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_journey AND motivo ILIKE '%pipeline%';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 30: o motivo deveria citar o pipeline, achei %', v_qtd; END IF;

  -- evento de auditoria
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_responsavel_auto';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 31: esperava 1 evento onboarding_responsavel_auto, achei %', v_qtd; END IF;

  -- ========== 12. a carga muda a próxima escolha ==========
  UPDATE public.onboarding_journeys SET situacao = 'em_andamento' WHERE id = v_journey;

  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_pipe, NULL, 'onboarding');
  SELECT (m->>'jornadas_ativas')::int INTO v_qtd
    FROM jsonb_array_elements(v_pool->'membros') m WHERE (m->>'user_id')::uuid = v_u1;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 32: u1 deveria aparecer com 1 jornada ativa, veio %', v_qtd; END IF;

  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 33: com u1 ocupado deveria escolher u2, veio %', v_escolhido;
  END IF;

  -- jornada concluída deixa de contar como carga
  UPDATE public.onboarding_journeys SET situacao = 'concluido' WHERE id = v_journey;
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_pipe, NULL, 'onboarding');
  SELECT (m->>'jornadas_ativas')::int INTO v_qtd
    FROM jsonb_array_elements(v_pool->'membros') m WHERE (m->>'user_id')::uuid = v_u1;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 34: jornada concluida nao deveria contar como carga, veio %', v_qtd; END IF;

  -- ...mas o desempate por "quem assumiu há mais tempo" mantém u1 atrás de quem
  -- nunca recebeu jornada nenhuma. Zerar a carga não devolve a vez na fila.
  v_escolhido := public.fn_onboarding_pick_assignee(v_tenant, v_pipe);
  IF v_escolhido IS DISTINCT FROM v_u2 THEN
    RAISE EXCEPTION 'FALHOU 35: empate em carga deveria ir para quem nunca recebeu (u2), veio %', v_escolhido;
  END IF;

  UPDATE public.onboarding_journeys SET situacao = 'em_andamento' WHERE id = v_journey;

  -- ========== 13. a jornada vai para a lista do pipeline, não para o setor ==========
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, round_robin_last_index, is_active)
  VALUES (v_tenant, v_pipe, 'round_robin', ARRAY[v_u4], -1, true);

  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Lista', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id, ticket_id INTO v_resp, v_ticket
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u4 THEN
    RAISE EXCEPTION 'FALHOU 36: jornada deveria ir para a lista do pipeline (u4), veio %', v_resp;
  END IF;

  -- o setor do pipeline continua no ticket, mesmo com o responsável sendo de outro setor
  SELECT department_id INTO v_tdept FROM public.support_tickets WHERE id = v_ticket;
  IF v_tdept IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 37: ticket deveria herdar o setor do pipeline, veio %', v_tdept;
  END IF;

  -- ========== 14. escolha manual continua mandando ==========
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Manual', NULL, NULL, NULL, v_u3, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u3 THEN
    RAISE EXCEPTION 'FALHOU 38: implantador escolhido na mao deveria ser respeitado, veio %', v_resp;
  END IF;

  -- ========== 15. sem lista E sem setor, quem cria vira dono ==========
  -- Sem isso, todo tenant que ainda não configurou passaria a criar jornada órfã.
  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;
  UPDATE public.onboarding_pipelines SET department_id = NULL WHERE id = v_pipe;
  v_journey := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Jornada Sem Nada', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_resp IS DISTINCT FROM v_u1 THEN
    RAISE EXCEPTION 'FALHOU 39: sem lista e sem setor deveria cair em auth.uid() = u1, veio %', v_resp;
  END IF;
  UPDATE public.onboarding_pipelines SET department_id = v_dept WHERE id = v_pipe;

  -- ========== 16. leitura para a UI ==========
  DELETE FROM public.onboarding_assignment_rules WHERE tenant_id = v_tenant;

  -- sem regra: origem 'setor', e o pipeline vem identificado
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_pipe, NULL, 'onboarding');
  IF (v_pool->>'pipeline_id')::uuid IS DISTINCT FROM v_pipe THEN
    RAISE EXCEPTION 'FALHOU 40: pool deveria devolver o pipeline pedido, veio %', v_pool->>'pipeline_id';
  END IF;
  IF v_pool->>'origem' <> 'setor' THEN
    RAISE EXCEPTION 'FALHOU 41: sem lista a origem deveria ser setor, veio %', v_pool->>'origem';
  END IF;
  IF (v_pool->>'department_id')::uuid IS DISTINCT FROM v_dept THEN
    RAISE EXCEPTION 'FALHOU 42: pool deveria devolver o setor do pipeline (vai para o ticket)';
  END IF;
  IF jsonb_array_length(v_pool->'membros') <> 3 THEN
    RAISE EXCEPTION 'FALHOU 43: pool deveria trazer os 3 membros do setor, veio %', jsonb_array_length(v_pool->'membros');
  END IF;
  IF NOT (v_pool->'membros'->0 ? 'jornadas_ativas') OR NOT (v_pool->'membros'->0 ? 'nome') THEN
    RAISE EXCEPTION 'FALHOU 44: membro do pool precisa de nome e jornadas_ativas';
  END IF;

  -- resolvendo o pipeline pelo produto/fase, sem passar pipeline_id
  v_pool := public.fn_onboarding_assignment_pool(v_tenant, NULL, NULL, 'onboarding');
  IF (v_pool->>'pipeline_id')::uuid IS DISTINCT FROM v_pipe THEN
    RAISE EXCEPTION 'FALHOU 45: pool por fase deveria resolver o pipeline, veio %', v_pool->>'pipeline_id';
  END IF;

  -- com lista: origem 'lista', na ordem do array, com gente de fora do setor
  INSERT INTO public.onboarding_assignment_rules
    (tenant_id, pipeline_id, strategy, included_agents, is_active)
  VALUES (v_tenant, v_pipe, 'round_robin', ARRAY[v_u4, v_u1], true);

  v_pool := public.fn_onboarding_assignment_pool(v_tenant, v_pipe, NULL, 'onboarding');
  IF v_pool->>'origem' <> 'lista' THEN
    RAISE EXCEPTION 'FALHOU 46: com lista a origem deveria ser lista, veio %', v_pool->>'origem';
  END IF;
  IF jsonb_array_length(v_pool->'membros') <> 2 THEN
    RAISE EXCEPTION 'FALHOU 47: esperava 2 membros na lista, veio %', jsonb_array_length(v_pool->'membros');
  END IF;
  IF (v_pool->'membros'->0->>'user_id')::uuid IS DISTINCT FROM v_u4 THEN
    RAISE EXCEPTION 'FALHOU 48: o pool deveria respeitar a ordem do array';
  END IF;
  IF v_pool->>'pipeline_nome' <> 'ZZ Pipeline' THEN
    RAISE EXCEPTION 'FALHOU 49: pool deveria devolver o nome do pipeline, veio %', v_pool->>'pipeline_nome';
  END IF;

  RAISE NOTICE 'OK: 03_distribuicao — 49 asserções passaram';
END $$;

ROLLBACK;
