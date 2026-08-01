-- Avanço de fase: encerramento do SLA, gatilho respeitado e duração útil gravada.
--
-- DOIS BUGS corrigidos aqui, achados ao implementar (01/08):
--
-- 1. `sla_iniciado_em = COALESCE(sla_iniciado_em, v_now)` ligava o relógio no avanço de
--    fase IGNORANDO o gate do inicia_sla criado em 26/07. Uma jornada cujo pipeline tem
--    etapa gatilho e ainda não passou por ela tinha o SLA ligado pelo avanço.
--    Estava nas DUAS funções — inclusive em advance_onboarding_to_implantacao, que é o
--    caminho quente (toda jornada passa por ele).
--
-- 2. advance_onboarding_to_implantacao fechava o histórico gravando só `duracao_minutos`,
--    deixando `duracao_util_minutos` NULL. É a origem das 19 linhas furadas que a Régua
--    precisa; o backfill conserta o passado, isto impede novas.
--
-- Base: md5 cbc3a2de… e c5dfd9b8…, idênticos em local e produção em 01/08.

-- ─────────────────────────────────────────────── onboarding → implantação (hot path)
CREATE OR REPLACE FUNCTION public.advance_onboarding_to_implantacao(
  p_journey_id uuid,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_parent uuid; v_fase public.onb_fase_atual; v_pipe_imp uuid;
  v_cur uuid; v_is_final boolean; v_first_imp uuid; v_open_hist uuid; v_now timestamptz := now();
  v_novo_resp uuid; v_resp_atual uuid;
  -- 01/08
  v_hist_stage uuid; v_dept uuid;
  v_first_inicia boolean; v_pipe_tem_gatilho boolean;
  v_first_encerra boolean; v_enc_em timestamptz; v_enc_stage uuid;
  v_ordem_alvo int; v_ordem_enc int;
  v_reabre boolean := false; v_encerra_agora boolean := false;
BEGIN
  SELECT tenant_id, ticket_id, fase_atual, pipeline_implantacao_id, current_stage_id
    INTO v_tenant, v_parent, v_fase, v_pipe_imp, v_cur
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_fase <> 'onboarding' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_em_onboarding');
  END IF;
  IF v_pipe_imp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_pipeline_implantacao');
  END IF;

  SELECT is_final INTO v_is_final FROM public.onboarding_stages WHERE id = v_cur;
  IF NOT p_force AND COALESCE(v_is_final, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_etapa_final');
  END IF;

  SELECT id INTO v_first_imp FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_imp AND ativo ORDER BY is_initial DESC, position LIMIT 1;
  IF v_first_imp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'implantacao_sem_etapa');
  END IF;

  -- fecha a etapa aberta atual (onboarding), medindo em horário útil como
  -- move_onboarding_stage já faz. Sem isto a Régua fica com buraco.
  SELECT id, stage_id INTO v_open_hist, v_hist_stage
    FROM public.onboarding_stage_history
   WHERE journey_id = p_journey_id AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;
  IF v_open_hist IS NOT NULL THEN
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_parent
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open_hist;
  END IF;

  -- gatilho e encerramento resolvidos contra o pipeline/etapa de DESTINO
  SELECT COALESCE(inicia_sla,false), COALESCE(encerra_sla,false)
    INTO v_first_inicia, v_first_encerra
    FROM public.onboarding_stages WHERE id = v_first_imp;
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = v_pipe_imp AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;

  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  v_ordem_alvo := public.fn_onb_stage_ordem(v_first_imp);
  v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
                       ELSE public.fn_onb_stage_ordem(v_enc_stage) END;
  v_encerra_agora := COALESCE(v_first_encerra,false) AND v_enc_em IS NULL;
  v_reabre := v_enc_em IS NOT NULL AND NOT COALESCE(v_first_encerra,false)
              AND v_ordem_enc IS NOT NULL AND v_ordem_alvo IS NOT NULL
              AND v_ordem_alvo < v_ordem_enc;

  UPDATE public.onboarding_journeys
     SET fase_atual = 'implantacao', current_stage_id = v_first_imp,
         situacao = CASE WHEN situacao = 'nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = CASE
           WHEN COALESCE(v_pipe_tem_gatilho,false) AND COALESCE(v_first_inicia,false)
             THEN COALESCE(sla_iniciado_em, v_now)
           WHEN COALESCE(v_pipe_tem_gatilho,false) THEN sla_iniciado_em
           ELSE COALESCE(sla_iniciado_em, v_now)
         END,
         sla_encerrado_em = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_em, v_now)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_em
         END,
         sla_encerrado_stage_id = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_stage_id, v_first_imp)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_stage_id
         END,
         onboarding_concluido_em = COALESCE(onboarding_concluido_em, v_now),
         implantacao_iniciada_em = COALESCE(implantacao_iniciada_em, v_now)
   WHERE id = p_journey_id;

  PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'onboarding');

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, v_first_imp);

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_fase_implantacao',
          'Onboarding concluído · Implantação iniciada');

  IF v_encerra_agora THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_sla_encerrado',
            'Contagem de SLA encerrada no início da Implantação');
  ELSIF v_reabre THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_sla_reaberto',
            'Contagem de SLA reaberta pelo avanço de fase');
  END IF;

  -- A responsabilidade passa para quem vai conduzir a implantacao: o "Conduzido por"
  -- do treino mais recente da jornada. Roda DEPOIS de fn_snapshot_onboarding_phase,
  -- para a metrica da fase onboarding ficar com quem realmente fez o onboarding.
  -- Sem treino, sem condutor, condutor de outro tenant ou condutor que ja e o
  -- responsavel: mantem quem esta. A conclusao do onboarding nunca falha por isso.
  SELECT ts.conduzido_por INTO v_novo_resp
    FROM public.onboarding_training_sessions ts
   WHERE ts.journey_id = p_journey_id AND ts.conduzido_por IS NOT NULL
   ORDER BY ts.created_at DESC
   LIMIT 1;

  SELECT responsavel_user_id INTO v_resp_atual
    FROM public.onboarding_journeys WHERE id = p_journey_id;

  IF v_novo_resp IS NOT NULL
     AND v_novo_resp IS DISTINCT FROM v_resp_atual
     AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = v_novo_resp AND p.tenant_id = v_tenant)
  THEN
    BEGIN
      PERFORM public.transfer_onboarding_responsavel(
        p_journey_id, v_novo_resp, 'Finalização da etapa do onboarding');
    EXCEPTION WHEN OTHERS THEN
      v_novo_resp := NULL;
      RAISE WARNING 'Transferencia automatica de responsavel falhou na jornada %: %', p_journey_id, SQLERRM;
    END;
  ELSE
    v_novo_resp := NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', v_first_imp,
    'novo_responsavel_nome', (SELECT f.nome FROM public.profiles p
        LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
       WHERE p.user_id = v_novo_resp AND p.tenant_id = v_tenant));
END $function$;

-- ─────────────────────────────────────────────────── avanço genérico entre jornadas
CREATE OR REPLACE FUNCTION public.advance_onboarding_phase(
  p_journey_id uuid,
  p_target_phase_id uuid DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_produto bigint;
  v_cur_phase uuid; v_cur_slug text; v_cur_stage uuid; v_situacao public.onb_situacao;
  v_tgt_phase uuid; v_tgt_slug text; v_tgt_nome text;
  v_pipe uuid; v_first uuid; v_is_final boolean;
  v_open_hist uuid; v_hist_stage uuid; v_dept uuid;
  v_now timestamptz := now();
  -- 01/08
  v_first_inicia boolean; v_pipe_tem_gatilho boolean;
  v_first_encerra boolean; v_enc_em timestamptz; v_enc_stage uuid;
  v_ordem_alvo int; v_ordem_enc int;
  v_reabre boolean := false; v_encerra_agora boolean := false;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.produto_id, j.current_phase_id, j.current_stage_id, j.situacao
    INTO v_tenant, v_ticket, v_produto, v_cur_phase, v_cur_stage, v_situacao
    FROM public.onboarding_journeys j WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_situacao IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_terminal');
  END IF;
  IF v_cur_phase IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_sem_fase');
  END IF;

  v_tgt_phase := COALESCE(p_target_phase_id, public.fn_onboarding_next_phase(p_journey_id));
  IF v_tgt_phase IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_proxima_fase');
  END IF;
  IF v_tgt_phase = v_cur_phase THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ja_nesta_fase');
  END IF;

  SELECT slug INTO v_cur_slug FROM public.onboarding_phases WHERE id = v_cur_phase;
  SELECT slug, nome INTO v_tgt_slug, v_tgt_nome FROM public.onboarding_phases WHERE id = v_tgt_phase;

  -- Caminho histórico: quem manda continua sendo a RPC específica.
  IF v_cur_slug = 'onboarding' AND v_tgt_slug = 'implantacao' THEN
    RETURN public.advance_onboarding_to_implantacao(p_journey_id, p_force);
  END IF;

  -- Só avança da etapa final, salvo force.
  SELECT is_final INTO v_is_final FROM public.onboarding_stages WHERE id = v_cur_stage;
  IF NOT p_force AND COALESCE(v_is_final, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_etapa_final');
  END IF;

  -- Pipeline da fase destino: prioriza o do produto da jornada, e só entre os que têm etapa.
  SELECT p.id INTO v_pipe FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.phase_id = v_tgt_phase AND p.ativo
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY (p.produto_id = v_produto) DESC NULLS LAST, p.position
   LIMIT 1;

  IF v_pipe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fase_sem_pipeline', 'fase', v_tgt_nome);
  END IF;

  SELECT id INTO v_first FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo ORDER BY is_initial DESC, position LIMIT 1;
  IF v_first IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fase_sem_etapa', 'fase', v_tgt_nome);
  END IF;

  -- Fecha a etapa aberta, medindo em horário útil como move_onboarding_stage faz.
  SELECT h.id, h.stage_id INTO v_open_hist, v_hist_stage
    FROM public.onboarding_stage_history h
   WHERE h.journey_id = p_journey_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open_hist IS NOT NULL THEN
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open_hist;
  END IF;

  -- gatilho e encerramento resolvidos contra o pipeline/etapa de DESTINO
  SELECT COALESCE(inicia_sla,false), COALESCE(encerra_sla,false)
    INTO v_first_inicia, v_first_encerra
    FROM public.onboarding_stages WHERE id = v_first;
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = v_pipe AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;

  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  v_ordem_alvo := public.fn_onb_stage_ordem(v_first);
  v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
                       ELSE public.fn_onb_stage_ordem(v_enc_stage) END;
  v_encerra_agora := COALESCE(v_first_encerra,false) AND v_enc_em IS NULL;
  v_reabre := v_enc_em IS NOT NULL AND NOT COALESCE(v_first_encerra,false)
              AND v_ordem_enc IS NOT NULL AND v_ordem_alvo IS NOT NULL
              AND v_ordem_alvo < v_ordem_enc;

  -- Os marcos legados continuam sendo mantidos enquanto vw_onboarding_journeys existir.
  UPDATE public.onboarding_journeys
     SET current_phase_id = v_tgt_phase,
         current_stage_id = v_first,
         situacao = CASE WHEN situacao = 'nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = CASE
           WHEN COALESCE(v_pipe_tem_gatilho,false) AND COALESCE(v_first_inicia,false)
             THEN COALESCE(sla_iniciado_em, v_now)
           WHEN COALESCE(v_pipe_tem_gatilho,false) THEN sla_iniciado_em
           ELSE COALESCE(sla_iniciado_em, v_now)
         END,
         sla_encerrado_em = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_em, v_now)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_em
         END,
         sla_encerrado_stage_id = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_stage_id, v_first)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_stage_id
         END,
         onboarding_concluido_em  = CASE WHEN v_cur_slug = 'onboarding'  THEN COALESCE(onboarding_concluido_em,  v_now) ELSE onboarding_concluido_em  END,
         implantacao_concluida_em = CASE WHEN v_cur_slug = 'implantacao' THEN COALESCE(implantacao_concluida_em, v_now) ELSE implantacao_concluida_em END,
         implantacao_iniciada_em  = CASE WHEN v_tgt_slug = 'implantacao' THEN COALESCE(implantacao_iniciada_em,  v_now) ELSE implantacao_iniciada_em  END
   WHERE id = p_journey_id;

  -- A linha da fase (abrir a nova, fechar a anterior) é responsabilidade do trigger
  -- trg_open_onb_phase_row; congela o SLA da fase que terminou quando ela tem enum.
  IF v_cur_slug IN ('onboarding','implantacao') THEN
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, v_cur_slug::public.onb_fase);
  END IF;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, v_first);

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_fase_avancou',
          'Jornada avançou para ' || COALESCE(v_tgt_nome, 'próxima fase'));

  IF v_encerra_agora THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_encerrado',
            'Contagem de SLA encerrada ao entrar em ' || COALESCE(v_tgt_nome, 'próxima fase'));
  ELSIF v_reabre THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_reaberto',
            'Contagem de SLA reaberta pelo avanço para ' || COALESCE(v_tgt_nome, 'próxima fase'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', v_first, 'phase_id', v_tgt_phase, 'fase', v_tgt_nome);
END $function$;
