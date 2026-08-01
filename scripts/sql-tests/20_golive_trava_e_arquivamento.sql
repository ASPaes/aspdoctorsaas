-- Asserções do go-live (31/07): trava com sub-ticket em aberto e arquivamento dos
-- treinos na etapa final da Implantação.
--
-- Cobre o caminho NOVO (jornada com fase seguinte configurada → advance_onboarding_phase),
-- que era justamente o que não tinha trava nenhuma.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/20_golive_trava_e_arquivamento.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_pai uuid; v_uid uuid;
  v_pipe uuid; v_st_ini uuid; v_st_fim uuid; v_st_meio uuid;
  v_next uuid; v_next_pipe uuid;
  v_t1 uuid; v_t2 uuid; v_t3 uuid;
  v_res jsonb; v_qtd int; v_txt text; v_stage uuid;
  v_situacao public.onb_situacao; v_golive date; v_concl timestamptz;
BEGIN
  -- ── fixture: jornada real em Implantação, para não esbarrar em constraint de dado sintético
  SELECT j.id, j.tenant_id, j.ticket_id INTO v_journey, v_tenant, v_pai
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s    ON s.id = j.current_stage_id
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases f    ON f.id = p.phase_id
   WHERE f.slug = 'implantacao' AND j.situacao = 'em_andamento'
   ORDER BY j.created_at DESC LIMIT 1;
  IF v_journey IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada em Implantação em andamento'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin/head no tenant'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  v_st_ini := public.fn_onb_training_initial_stage(v_journey);
  IF v_st_ini IS NULL THEN RAISE EXCEPTION 'PRE: jornada sem etapa inicial de implantação'; END IF;
  SELECT pipeline_id INTO v_pipe FROM public.onboarding_stages WHERE id = v_st_ini;
  SELECT id INTO v_st_fim  FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND is_final ORDER BY position LIMIT 1;
  SELECT id INTO v_st_meio FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo AND NOT is_final AND id <> v_st_ini ORDER BY position LIMIT 1;
  IF v_st_fim IS NULL OR v_st_meio IS NULL THEN RAISE EXCEPTION 'PRE: pipeline sem etapa final ou intermediária'; END IF;

  -- Este teste exige o caminho com fase seguinte: é o que passou a valer em prod e o
  -- que não tinha trava. Sem ele, o teste estaria validando só o caminho antigo.
  v_next := public.fn_onboarding_next_phase(v_journey);
  IF v_next IS NULL THEN RAISE EXCEPTION 'PRE: jornada sem fase seguinte — este teste cobre o caminho advance'; END IF;
  SELECT p.id INTO v_next_pipe FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.phase_id = v_next AND p.ativo
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   LIMIT 1;
  IF v_next_pipe IS NULL THEN RAISE EXCEPTION 'PRE: fase seguinte sem pipeline com etapa ativa'; END IF;

  -- zera o passado da jornada: só os treinos criados aqui decidem o teste
  UPDATE public.onboarding_training_sessions
     SET status = 'realizado'::public.onb_treino_status, realizado_em = COALESCE(realizado_em, now())
   WHERE journey_id = v_journey AND deleted_at IS NULL
     AND status NOT IN ('realizado'::public.onb_treino_status, 'cancelado'::public.onb_treino_status);

  v_t1 := public.create_onboarding_training(v_journey, 'ZZ Golive 1');
  v_t2 := public.create_onboarding_training(v_journey, 'ZZ Golive 2');
  v_t3 := public.create_onboarding_training(v_journey, 'ZZ Golive cancelado');

  SELECT situacao, go_live_real INTO v_situacao, v_golive
    FROM public.onboarding_journeys WHERE id = v_journey;

  -- ── 1. trava: go-live com sub-ticket de treinamento em aberto
  v_res := public.journey_go_live(v_journey, current_date);
  IF COALESCE((v_res->>'ok')::boolean, true) THEN
    RAISE EXCEPTION 'FALHOU 1a: go-live passou com treino em aberto → %', v_res::text;
  END IF;
  IF v_res->>'reason' <> 'treinos_em_aberto' THEN
    RAISE EXCEPTION 'FALHOU 1b: reason esperado treinos_em_aberto, veio %', v_res::text;
  END IF;
  IF COALESCE((v_res->>'qtd')::int, 0) < 3 THEN
    RAISE EXCEPTION 'FALHOU 1c: esperava ao menos 3 abertos, veio %', v_res::text;
  END IF;
  IF v_res->>'codigos' IS NULL THEN
    RAISE EXCEPTION 'FALHOU 1d: retorno sem os códigos dos sub-tickets abertos';
  END IF;

  -- ── 2. a trava não pode ter deixado rastro na jornada
  SELECT situacao, go_live_real, implantacao_concluida_em INTO v_situacao, v_golive, v_concl
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_situacao <> 'em_andamento'::public.onb_situacao THEN
    RAISE EXCEPTION 'FALHOU 2a: situação mudou apesar da trava → %', v_situacao;
  END IF;
  IF v_concl IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 2b: implantacao_concluida_em gravada apesar da trava';
  END IF;

  -- ── 3. encerra os filhos pelo caminho que o front usa no botão "Realizado":
  --      escreve status direto, SEM passar pela etapa final. É esse treino que sumia.
  UPDATE public.onboarding_training_sessions
     SET status = 'realizado'::public.onb_treino_status, realizado_em = now()
   WHERE id IN (v_t1, v_t2);
  PERFORM public.move_onboarding_training_stage(v_t1, v_st_meio);

  UPDATE public.onboarding_training_sessions
     SET status = 'cancelado'::public.onb_treino_status
   WHERE id = v_t3;

  SELECT count(*) INTO v_qtd FROM public.onboarding_training_sessions
   WHERE id IN (v_t1, v_t2) AND current_stage_id = v_st_fim;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'PRE 3: os dois treinos deveriam estar fora da etapa final'; END IF;

  -- ── 4. agora o go-live passa, e leva os treinos até a etapa final
  v_res := public.journey_go_live(v_journey, current_date);
  IF NOT COALESCE((v_res->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'FALHOU 4a: go-live recusado com todos os filhos encerrados → %', v_res::text;
  END IF;
  -- Desde 01/08 o go-live conclui sempre: acompanhamento virou ticket, não fase de destino.
  IF NOT (v_res->>'concluiu')::boolean THEN
    RAISE EXCEPTION 'FALHOU 4b: go-live deveria concluir a jornada → %', v_res::text;
  END IF;
  IF COALESCE((v_res->>'treinos_arquivados')::int, 0) < 2 THEN
    RAISE EXCEPTION 'FALHOU 4c: esperava ao menos 2 treinos arquivados, veio %', v_res::text;
  END IF;

  -- ── 5. todo treino realizado da jornada terminou numa etapa final
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_training_sessions t
    LEFT JOIN public.onboarding_stages s ON s.id = t.current_stage_id
   WHERE t.journey_id = v_journey AND t.deleted_at IS NULL
     AND t.status = 'realizado'::public.onb_treino_status
     AND COALESCE(s.is_final, false) = false;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 5: % treino(s) realizado(s) ficaram fora da etapa final', v_qtd;
  END IF;

  -- ── 6. o arquivamento é auditável: linha de histórico aberta na etapa final
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_training_stage_history h
   WHERE h.training_id IN (v_t1, v_t2) AND h.stage_id = v_st_fim AND h.saiu_em IS NULL;
  IF v_qtd <> 2 THEN
    RAISE EXCEPTION 'FALHOU 6a: esperava 2 linhas de histórico abertas na etapa final, achei %', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd
    FROM public.support_ticket_events e
   WHERE e.ticket_id = v_pai AND e.event_type = 'onboarding_treino_movido'
     AND e.new_value = (SELECT nome FROM public.onboarding_stages WHERE id = v_st_fim);
  IF v_qtd < 2 THEN
    RAISE EXCEPTION 'FALHOU 6b: esperava ao menos 2 eventos de movimentação no ticket pai, achei %', v_qtd;
  END IF;

  -- ── 7. cancelado não é arrastado para a coluna final
  SELECT current_stage_id, status::text INTO v_stage, v_txt
    FROM public.onboarding_training_sessions WHERE id = v_t3;
  IF v_txt <> 'cancelado' THEN RAISE EXCEPTION 'FALHOU 7a: treino 3 deveria seguir cancelado, está %', v_txt; END IF;
  IF v_stage = v_st_fim THEN RAISE EXCEPTION 'FALHOU 7b: treino cancelado foi movido para a etapa final'; END IF;

  -- ── 8. o go-live ficou gravado na jornada
  SELECT go_live_real, implantacao_concluida_em INTO v_golive, v_concl
    FROM public.onboarding_journeys WHERE id = v_journey;
  IF v_golive IS NULL THEN RAISE EXCEPTION 'FALHOU 8a: go_live_real não foi gravado'; END IF;
  IF v_concl IS NULL THEN RAISE EXCEPTION 'FALHOU 8b: implantacao_concluida_em não foi gravado'; END IF;

  -- ── 9. a fase Implantação fechou — é dela que o quadro tira a janela de 30 dias
  SELECT count(*) INTO v_qtd FROM public.vw_onboarding_journey_phases v
   WHERE v.journey_id = v_journey AND v.phase_slug = 'implantacao'
     AND NOT v.aberta AND v.concluida_em IS NOT NULL;
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 9: a fase Implantação não fechou com concluida_em (achei % linha[s])', v_qtd;
  END IF;

  -- ── 10. idempotência: rodar o arquivamento de novo não cria histórico duplicado
  v_qtd := public.fn_onb_arquivar_treinos_no_golive(v_journey);
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU 10: segunda passada moveu % treino(s) que já estavam na etapa final', v_qtd;
  END IF;

  RAISE NOTICE 'OK — trava do go-live e arquivamento na etapa final passaram';
END $$;

ROLLBACK;
