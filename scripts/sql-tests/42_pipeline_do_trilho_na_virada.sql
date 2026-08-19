-- O ticket não pode trocar de trilho ao virar de fase.
--
-- Bug de 12/08/2026 (TK-2026-3092, Digi Office): a jornada nasceu no "Onboarding Gula"
-- e foi parar na "Implantação PDV". create_onboarding_journey resolve os DOIS pipelines
-- na criação e CONGELA em pipeline_implantacao_id; naquele momento a "Implantação Gula"
-- ainda não tinha etapa nenhuma, e o guard `EXISTS (stages ativas)` a descartou.
-- advance_onboarding_to_implantacao só lê a coluna congelada — nunca reavalia.
--
-- Segundo defeito, mesma família: advance_onboarding_phase (Implantação → Acompanhamento
-- e fases criadas pelo tenant) escolhe o pipeline SEM filtrar por produto no WHERE. Em
-- `ORDER BY (produto_id = v_produto) DESC NULLS LAST` o `false` (pipeline dedicado de
-- OUTRO produto) vem antes do NULL (genérico) — é o mesmo erro corrigido em 07/08 nas
-- fn_onb_trilho_* (ver 27_trilho_pipeline_do_produto.sql), que ficou para trás aqui.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/42_pipeline_do_trilho_na_virada.sql
BEGIN;

CREATE OR REPLACE FUNCTION public.can_access_tenant_row(row_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;

DO $$
DECLARE
  v_tenant uuid; v_cliente uuid; v_produto bigint;
  v_pipe_onb_prod uuid; v_pipe_imp_prod uuid; v_pipe_imp_generico uuid;
  v_phase_imp uuid; v_phase_acomp uuid;
  v_j uuid; v_gravado uuid; v_res jsonb; v_stage_final uuid;
  v_pipe_depois uuid; v_pipe_stage uuid; v_nome text;
  v_j2 uuid; v_prod_orfao bigint; v_pipe_intruso uuid; v_pipe_escolhido uuid;
BEGIN
  -- ---------------------------------------------------------------- fixture
  -- Um trilho de produto: pipeline próprio na fase de Onboarding E na de Implantação.
  SELECT po.tenant_id, po.produto_id, po.id, pi.id, ph_i.id
    INTO v_tenant, v_produto, v_pipe_onb_prod, v_pipe_imp_prod, v_phase_imp
    FROM public.onboarding_pipelines po
    JOIN public.onboarding_phases ph_o ON ph_o.id = po.phase_id AND ph_o.slug = 'onboarding'
    JOIN public.onboarding_pipelines pi ON pi.tenant_id = po.tenant_id AND pi.produto_id = po.produto_id
    JOIN public.onboarding_phases ph_i ON ph_i.id = pi.phase_id AND ph_i.slug = 'implantacao'
   WHERE po.produto_id IS NOT NULL AND po.ativo AND pi.ativo
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = po.id AND s.ativo)
   ORDER BY po.position LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'PRE: nenhum produto com pipeline próprio nas duas fases';
  END IF;

  -- o genérico da mesma fase é para onde o bug empurra o ticket
  SELECT p.id INTO v_pipe_imp_generico FROM public.onboarding_pipelines p
   WHERE p.phase_id = v_phase_imp AND p.tenant_id = v_tenant AND p.ativo AND p.produto_id IS NULL
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY p.position LIMIT 1;
  IF v_pipe_imp_generico IS NULL THEN
    RAISE EXCEPTION 'PRE: fase de Implantação sem pipeline genérico com etapas';
  END IF;

  SELECT c.id INTO v_cliente FROM public.clientes c WHERE c.tenant_id = v_tenant LIMIT 1;
  IF v_cliente IS NULL THEN RAISE EXCEPTION 'PRE: tenant sem cliente'; END IF;

  -- Reproduz o instante do bug: o pipeline do produto na Implantação ainda SEM etapa.
  DELETE FROM public.onboarding_stages WHERE pipeline_id = v_pipe_imp_prod;

  -- --------------------------------------------------- 1. criação congela errado
  v_j := public.create_onboarding_journey(
           v_tenant, v_cliente, '[TESTE 35] trilho na virada', v_produto);

  SELECT pipeline_onboarding_id, pipeline_implantacao_id INTO v_pipe_depois, v_gravado
    FROM public.onboarding_journeys WHERE id = v_j;

  IF v_pipe_depois <> v_pipe_onb_prod THEN
    RAISE EXCEPTION 'PRE 1: jornada nasceu no pipeline de onboarding % e não no do produto %',
      v_pipe_depois, v_pipe_onb_prod;
  END IF;
  IF v_gravado <> v_pipe_imp_generico THEN
    RAISE EXCEPTION 'PRE 1b: fixture não reproduz o congelamento — gravou % (esperado o genérico %)',
      v_gravado, v_pipe_imp_generico;
  END IF;

  -- Só DEPOIS o pipeline do produto ganha etapas (foi o que aconteceu às 18:31 de 12/08).
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, ativo)
  VALUES (v_tenant, v_pipe_imp_prod, '[TESTE 35] Pendências', 'teste35-pendencias', 1, true, true);

  -- ------------------------------------------- 2. a virada tem que seguir o trilho
  SELECT id INTO v_stage_final FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_onb_prod AND ativo ORDER BY position DESC LIMIT 1;
  UPDATE public.onboarding_journeys SET current_stage_id = v_stage_final WHERE id = v_j;

  v_res := public.advance_onboarding_to_implantacao(v_j, true, true);
  IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 2a: avanço recusado — %', v_res::text;
  END IF;

  SELECT j.pipeline_implantacao_id, s.pipeline_id
    INTO v_pipe_depois, v_pipe_stage
    FROM public.onboarding_journeys j
    LEFT JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.id = v_j;

  IF v_pipe_stage <> v_pipe_imp_prod THEN
    SELECT nome INTO v_nome FROM public.onboarding_pipelines WHERE id = v_pipe_stage;
    RAISE EXCEPTION 'FALHA 2: ticket do produto % caiu na etapa do pipeline «%» — o trilho tem % com etapa',
      v_produto, COALESCE(v_nome, '(nenhum)'), (SELECT nome FROM public.onboarding_pipelines WHERE id = v_pipe_imp_prod);
  END IF;
  IF v_pipe_depois <> v_pipe_imp_prod THEN
    RAISE EXCEPTION 'FALHA 2b: etapa certa mas pipeline_implantacao_id continua em % — o quadro e a coluna discordam',
      v_pipe_depois;
  END IF;

  -- ------------------------- 3. advance_onboarding_phase não pode pegar trilho alheio
  SELECT ph.id INTO v_phase_acomp FROM public.onboarding_phases ph
   WHERE ph.tenant_id = v_tenant AND ph.slug = 'acompanhamento' LIMIT 1;
  IF v_phase_acomp IS NULL THEN RAISE EXCEPTION 'PRE 3: tenant sem fase de acompanhamento'; END IF;
  UPDATE public.onboarding_phases SET ativo = true WHERE id = v_phase_acomp;

  -- produto que NÃO tem pipeline próprio: tem que cair no genérico da fase
  SELECT pr.id INTO v_prod_orfao FROM public.produtos pr
   WHERE pr.tenant_id = v_tenant
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_pipelines p
                      WHERE p.tenant_id = v_tenant AND p.produto_id = pr.id AND p.ativo)
   ORDER BY pr.id LIMIT 1;
  IF v_prod_orfao IS NULL THEN RAISE EXCEPTION 'PRE 3b: todo produto do tenant tem pipeline próprio'; END IF;

  -- intruso: pipeline dedicado a OUTRO produto, na mesma fase, com etapa
  INSERT INTO public.onboarding_pipelines (tenant_id, phase_id, nome, produto_id, position, ativo)
  VALUES (v_tenant, v_phase_acomp, '[TESTE 35] Acomp de outro produto', v_produto, 9, true)
  RETURNING id INTO v_pipe_intruso;
  INSERT INTO public.onboarding_stages (tenant_id, pipeline_id, nome, slug, position, is_initial, ativo)
  VALUES (v_tenant, v_pipe_intruso, '[TESTE 35] Intrusa', 'teste35-intrusa', 1, true, true);

  v_j2 := public.create_onboarding_journey(
            v_tenant, v_cliente, '[TESTE 35] produto sem trilho próprio', v_prod_orfao);
  UPDATE public.onboarding_journeys
     SET current_phase_id = (SELECT id FROM public.onboarding_phases
                              WHERE tenant_id = v_tenant AND slug = 'implantacao')
   WHERE id = v_j2;

  v_res := public.advance_onboarding_phase(v_j2, v_phase_acomp, true);
  IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHA 3a: avanço de fase recusado — %', v_res::text;
  END IF;

  SELECT s.pipeline_id INTO v_pipe_escolhido
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.id = v_j2;

  IF v_pipe_escolhido = v_pipe_intruso THEN
    RAISE EXCEPTION 'FALHA 3: jornada do produto % entrou no pipeline dedicado do produto % (o «false» ordena antes do NULL genérico)',
      v_prod_orfao, v_produto;
  END IF;

  RAISE NOTICE 'OK 42_pipeline_do_trilho_na_virada — produto % entra na implantação do próprio trilho; produto % sem trilho cai no genérico',
    v_produto, v_prod_orfao;
END $$;

ROLLBACK;
