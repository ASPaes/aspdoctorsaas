-- Asserções das Etapas 2 e 3: cartão do treino no quadro, edição, exclusão e trava do pai.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/17_subticket_cartao_e_trava.sql
BEGIN;

DO $$
DECLARE
  v_journey uuid; v_tenant uuid; v_pai uuid; v_uid uuid;
  v_pipe uuid; v_st_ini uuid; v_st_fim uuid; v_st_meio uuid;
  v_t1 uuid; v_t2 uuid; v_tk1 uuid;
  v_res jsonb; v_qtd int; v_txt text; v_stage uuid;
  v_status public.onb_treino_status; v_realizado timestamptz;
  v_erro text;
BEGIN
  SELECT j.id, j.tenant_id, j.ticket_id INTO v_journey, v_tenant, v_pai
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s   ON s.id = j.current_stage_id
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
  SELECT id INTO v_st_fim  FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND is_final ORDER BY position LIMIT 1;
  SELECT id INTO v_st_meio FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND NOT is_final AND id <> v_st_ini ORDER BY position LIMIT 1;
  IF v_st_fim IS NULL OR v_st_meio IS NULL THEN RAISE EXCEPTION 'PRE: pipeline sem etapa final ou intermediária'; END IF;

  -- ── 1. treino nasce numa etapa e com uma linha de histórico
  v_t1 := public.create_onboarding_training(v_journey, 'ZZ Cartao 1');
  SELECT current_stage_id, ticket_id INTO v_stage, v_tk1
    FROM public.onboarding_training_sessions WHERE id = v_t1;
  IF v_stage IS DISTINCT FROM v_st_ini THEN
    RAISE EXCEPTION 'FALHOU 1a: treino nasceu fora da etapa inicial';
  END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_training_stage_history WHERE training_id = v_t1;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1b: esperava 1 linha de histórico, achei %', v_qtd; END IF;

  -- ── 2. mover fecha a linha anterior e abre a nova
  v_res := public.move_onboarding_training_stage(v_t1, v_st_meio);
  IF NOT (v_res->>'ok')::boolean THEN RAISE EXCEPTION 'FALHOU 2a: move recusou — %', v_res::text; END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_training_stage_history
   WHERE training_id = v_t1 AND saiu_em IS NOT NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 2b: esperava 1 linha fechada, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_training_stage_history
   WHERE training_id = v_t1 AND saiu_em IS NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 2c: esperava 1 linha aberta, achei %', v_qtd; END IF;

  -- ── 3. o histórico da JORNADA não foi tocado (é o motivo da tabela separada)
  SELECT count(*) INTO v_qtd FROM public.onboarding_stage_history
   WHERE journey_id = v_journey AND saiu_em IS NULL;
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 3: jornada deveria ter exatamente 1 etapa aberta, achei %', v_qtd;
  END IF;

  -- ── 4. entrar na etapa final marca realizado
  v_res := public.move_onboarding_training_stage(v_t1, v_st_fim);
  SELECT status, realizado_em INTO v_status, v_realizado
    FROM public.onboarding_training_sessions WHERE id = v_t1;
  IF v_status <> 'realizado'::public.onb_treino_status OR v_realizado IS NULL THEN
    RAISE EXCEPTION 'FALHOU 4: etapa final não marcou realizado (status=%, realizado_em=%)', v_status, v_realizado;
  END IF;

  -- ── 5. editar renomeia o assunto do sub-ticket junto
  v_res := public.update_onboarding_training(v_t1, p_titulo => 'ZZ Cartao 1 renomeado');
  SELECT assunto INTO v_txt FROM public.support_tickets WHERE id = v_tk1;
  IF v_txt IS DISTINCT FROM 'ZZ Cartao 1 renomeado' THEN
    RAISE EXCEPTION 'FALHOU 5: assunto do sub-ticket não acompanhou o título (achei %)', COALESCE(v_txt,'<null>');
  END IF;

  -- ── 6. excluir é recusado depois que o treino andou
  v_res := public.delete_onboarding_training(v_t1);
  IF (v_res->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 6: exclusão deveria ser recusada em treino realizado';
  END IF;

  -- ── 7. excluir é permitido em treino recém-criado
  v_t2 := public.create_onboarding_training(v_journey, 'ZZ Cartao 2');
  v_res := public.delete_onboarding_training(v_t2);
  IF NOT (v_res->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 7: exclusão de treino sem movimento foi recusada — %', v_res::text;
  END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_training_sessions
   WHERE id = v_t2 AND deleted_at IS NOT NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 7b: treino excluído não ficou marcado'; END IF;

  -- ── 8. a jornada não conclui com filho em aberto
  v_res := public.conclude_onboarding_journey(v_journey);
  IF (v_res->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 8: jornada concluiu com treino em aberto';
  END IF;
  IF v_res->>'reason' IS DISTINCT FROM 'treinos_em_aberto' THEN
    RAISE EXCEPTION 'FALHOU 8b: motivo esperado treinos_em_aberto, veio %', v_res::text;
  END IF;

  -- ── 9. o ticket pai também não fecha direto
  BEGIN
    UPDATE public.support_tickets SET concluido_em = now() WHERE id = v_pai;
    RAISE EXCEPTION 'FALHOU 9: ticket pai fechou com treino em aberto';
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS v_erro = MESSAGE_TEXT;
    IF v_erro LIKE 'FALHOU 9%' THEN RAISE; END IF;
    IF v_erro NOT LIKE '%sub-ticket(s) de treinamento em aberto%' THEN
      RAISE EXCEPTION 'FALHOU 9b: erro inesperado — %', v_erro;
    END IF;
  END;

  -- ── 10. fechando todos os filhos, a trava libera
  UPDATE public.onboarding_training_sessions
     SET status = 'cancelado'::public.onb_treino_status
   WHERE journey_id = v_journey AND deleted_at IS NULL
     AND status NOT IN ('realizado'::public.onb_treino_status, 'cancelado'::public.onb_treino_status);

  SELECT a.qtd INTO v_qtd FROM public.fn_onb_treinos_em_aberto(v_pai) a;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 10a: ainda restam % filho(s) em aberto', v_qtd; END IF;

  v_res := public.conclude_onboarding_journey(v_journey);
  IF NOT (v_res->>'ok')::boolean THEN
    RAISE EXCEPTION 'FALHOU 10b: jornada não concluiu mesmo sem filho em aberto — %', v_res::text;
  END IF;

  -- ── 11. o pai recebeu os eventos dos filhos
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_pai
     AND event_type IN ('onboarding_treino_movido','onboarding_treino_editado',
                        'onboarding_treino_excluido','onboarding_treino_status');
  IF v_qtd < 4 THEN
    RAISE EXCEPTION 'FALHOU 11: esperava pelo menos 4 eventos de filho na timeline do pai, achei %', v_qtd;
  END IF;

  RAISE NOTICE 'OK 17_subticket_cartao_e_trava — % eventos de filho no pai', v_qtd;
END $$;

ROLLBACK;
