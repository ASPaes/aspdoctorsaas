-- Asserções da RPC apply_onboarding_blueprint estendida (templates de implantação).
-- Rodar: scripts/sql-tests/run-com-migration.sh \
--          supabase/migrations/20260826180000_apply_onboarding_blueprint_grupos.sql \
--          scripts/sql-tests/45_apply_blueprint_grupos_e_flags.sql
--
-- Sobre a guarda de permissão da RPC: rodando como `postgres` no psql, `auth.uid()` é
-- NULL, `is_super_admin()` devolve NULL e `IF NOT v_is_allowed` não dispara (NULL não é
-- true). Por isso o teste chama a função direto, sem forjar JWT. Se a guarda mudar para
-- `COALESCE(..., false)`, este arquivo passa a precisar de `SET LOCAL request.jwt.claims`.
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_prod   bigint;
  v_res    jsonb;
  v_pipe   uuid;
  v_stage  uuid;
  v_group  uuid;
  v_qtd    int;
  v_txt    text;
  v_bool   boolean;
BEGIN
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Template') RETURNING id INTO v_tenant;
  INSERT INTO public.produtos (tenant_id, nome) VALUES (v_tenant, 'PDV Legal') RETURNING id INTO v_prod;

  -- ============ blueprint com os campos NOVOS ============
  v_res := public.apply_onboarding_blueprint(v_tenant, jsonb_build_object(
    'pipelines', jsonb_build_array(jsonb_build_object(
      'fase', 'implantacao',
      'nome', 'Implantação PDV',
      'descricao', 'teste',
      'produto_id', v_prod,
      'stages', jsonb_build_array(
        jsonb_build_object('nome','Pendências','sla_minutos',0,'cor','#EF4444'),
        jsonb_build_object('nome','Pendente Agendar','sla_minutos',0,'cor','#F59E0B',
                           'retorno_no_show', true,
                           'visible_sections', jsonb_build_array('timeline','checklist','acompanhamento')),
        jsonb_build_object('nome','Treinamento Marcado','sla_minutos',120,'cor','#22C55E',
                           'is_initial', true, 'inicia_sla', true,
                           'checklist_groups', jsonb_build_array(
                             jsonb_build_object('nome','Checklist PDV',
                               'demandas', jsonb_build_array('Novo Cliente'),
                               'itens', jsonb_build_array(
                                 jsonb_build_object('texto','Fundo de caixa | Sangria','is_required',true),
                                 jsonb_build_object('texto','Encerramento de caixa','is_required',true))),
                             jsonb_build_object('nome','Checklist Geral',
                               'demandas', jsonb_build_array('Novo Cliente','Mudança Regime Fiscal'),
                               'itens', jsonb_build_array(
                                 jsonb_build_object('texto','Enviar pesquisa satisfação','is_required',false))))),
        jsonb_build_object('nome','Sub-tickets Finalizados','sla_minutos',0,
                           'is_final', true, 'encerra_sla', true)
      )
    )),
    'demand_types', jsonb_build_array(jsonb_build_object('nome','Novo Cliente','descricao',NULL))
  ));

  -- 1. contagens no retorno
  IF (v_res->>'pipelines')::int <> 1 OR (v_res->>'stages')::int <> 4
     OR (v_res->>'checklist_items')::int <> 3 OR (v_res->>'checklist_groups')::int <> 2 THEN
    RAISE EXCEPTION 'FALHOU 1: retorno inesperado %', v_res;
  END IF;

  SELECT id INTO v_pipe FROM public.onboarding_pipelines WHERE tenant_id=v_tenant;

  -- 2. produto_id gravado no pipeline
  SELECT produto_id INTO v_qtd FROM public.onboarding_pipelines WHERE id=v_pipe;
  IF v_qtd IS DISTINCT FROM v_prod THEN RAISE EXCEPTION 'FALHOU 2: produto_id % <> %', v_qtd, v_prod; END IF;

  -- 3. is_initial respeita o que veio, e NÃO cai na primeira posição
  SELECT nome INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_initial;
  IF v_txt <> 'Treinamento Marcado' THEN RAISE EXCEPTION 'FALHOU 3: etapa inicial virou %', v_txt; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_initial;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 3b: % etapas iniciais', v_qtd; END IF;

  -- 4. flags de SLA, no-show, cor e visible_sections
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe AND nome='Treinamento Marcado' AND inicia_sla AND cor='#22C55E';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4a: inicia_sla/cor não gravados'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe AND nome='Sub-tickets Finalizados' AND encerra_sla AND is_final;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4b: encerra_sla/is_final não gravados'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe AND nome='Pendente Agendar' AND retorno_no_show
     AND visible_sections = ARRAY['timeline','checklist','acompanhamento'];
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 4c: retorno_no_show/visible_sections não gravados'; END IF;

  -- 5. grupos criados na ordem, com os itens dentro
  SELECT s.id INTO v_stage FROM public.onboarding_stages s
   WHERE s.pipeline_id=v_pipe AND s.nome='Treinamento Marcado';
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_checklist_groups WHERE stage_id=v_stage;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 5a: % grupos, esperava 2', v_qtd; END IF;
  SELECT id INTO v_group FROM public.onboarding_stage_checklist_groups
   WHERE stage_id=v_stage AND nome='Checklist PDV';
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_checklist WHERE group_id=v_group;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 5b: % itens no grupo, esperava 2', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_checklist
   WHERE stage_id=v_stage AND group_id IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5c: % item(ns) de checklist ficaram sem grupo', v_qtd; END IF;

  -- 6. vínculo grupo -> tipo de demanda, criando a demanda que faltava
  SELECT count(*) INTO v_qtd FROM public.onboarding_checklist_group_demand_types gd
    JOIN public.onboarding_demand_types d ON d.id=gd.demand_type_id
   WHERE gd.group_id = (SELECT id FROM public.onboarding_stage_checklist_groups
                         WHERE stage_id=v_stage AND nome='Checklist Geral');
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 6a: % vínculos de demanda, esperava 2', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_demand_types
   WHERE tenant_id=v_tenant AND nome='Mudança Regime Fiscal';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6b: demanda do grupo não foi criada'; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_demand_types
   WHERE tenant_id=v_tenant AND lower(nome)='novo cliente';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6c: "Novo Cliente" duplicou (% linhas)', v_qtd; END IF;

  -- 7. reimportar não duplica catálogo
  PERFORM public.apply_onboarding_blueprint(v_tenant, jsonb_build_object(
    'pipelines', '[]'::jsonb,
    'demand_types', jsonb_build_array(jsonb_build_object('nome','novo cliente','descricao',NULL))));
  SELECT count(*) INTO v_qtd FROM public.onboarding_demand_types WHERE tenant_id=v_tenant;
  IF v_qtd <> 2 THEN RAISE EXCEPTION 'FALHOU 7: catálogo foi para % linhas', v_qtd; END IF;

  -- ============ 8. REGRESSÃO: blueprint antigo (IA) sai igual ============
  v_res := public.apply_onboarding_blueprint(v_tenant, jsonb_build_object(
    'pipelines', jsonb_build_array(jsonb_build_object(
      'fase','onboarding','nome','Onboarding IA','descricao',NULL,
      'stages', jsonb_build_array(
        jsonb_build_object('nome','Primeira','sla_minutos',60,'pausa_sla',false,
          'checklist', jsonb_build_array(jsonb_build_object('texto','Item A','is_required',true))),
        jsonb_build_object('nome','Segunda','sla_minutos',60,'pausa_sla',false,'checklist','[]'::jsonb))
    ))));
  IF (v_res->>'stages')::int <> 2 OR (v_res->>'checklist_items')::int <> 1 THEN
    RAISE EXCEPTION 'FALHOU 8a: caminho antigo mudou %', v_res;
  END IF;
  SELECT id INTO v_pipe FROM public.onboarding_pipelines WHERE tenant_id=v_tenant AND nome='Onboarding IA';
  SELECT nome INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_initial;
  IF v_txt <> 'Primeira' THEN RAISE EXCEPTION 'FALHOU 8b: sem is_initial explícito, a inicial virou %', v_txt; END IF;
  SELECT nome INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND is_final;
  IF v_txt <> 'Segunda' THEN RAISE EXCEPTION 'FALHOU 8c: sem is_final explícito, a final virou %', v_txt; END IF;
  SELECT (group_id IS NULL) INTO v_bool FROM public.onboarding_stage_checklist
   WHERE stage_id=(SELECT id FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND nome='Primeira');
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU 8d: checklist plano ganhou grupo'; END IF;
  -- sem 'cor' no blueprint, a etapa tem que sair com o default da coluna, não com uma
  -- cor escolhida na função (senão o quadro do "Gerar com IA" muda de cor em silêncio)
  SELECT cor INTO v_txt FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND nome='Primeira';
  IF v_txt <> '#3b82f6' THEN RAISE EXCEPTION 'FALHOU 8e: cor default virou %', v_txt; END IF;
  -- e visible_sections tem que ser o default da coluna, não NULL nem lista vazia
  SELECT (visible_sections = '{participantes,timeline,pausas,modulos,contabilidade,treinos,checklist,atendimentos,eventos,anexos}'::text[])
    INTO v_bool FROM public.onboarding_stages WHERE pipeline_id=v_pipe AND nome='Primeira';
  IF NOT v_bool THEN RAISE EXCEPTION 'FALHOU 8f: visible_sections default não bateu'; END IF;

  -- 9. grants continuam de pé
  SELECT count(*) INTO v_qtd FROM information_schema.routine_privileges
   WHERE routine_name='apply_onboarding_blueprint' AND grantee IN ('authenticated','service_role');
  IF v_qtd < 2 THEN RAISE EXCEPTION 'FALHOU 9: grants sumiram (% de 2)', v_qtd; END IF;

  RAISE NOTICE 'OK: 45_apply_blueprint_grupos_e_flags — 9 blocos de asserção passaram';
END $$;

ROLLBACK;
