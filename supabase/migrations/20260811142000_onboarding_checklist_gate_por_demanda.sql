-- Gate de etapa respeitando o vínculo de checklist por tipo de demanda (11/08/2026).
-- Mudam só a leitura do demand_type_id e os DOIS caminhos de contagem de obrigatórios.
-- SLA, histórico de etapa e eventos de timeline seguem idênticos.

CREATE OR REPLACE FUNCTION public.move_onboarding_stage(p_journey_id uuid, p_target_stage_id uuid, p_completed_checklist_ids uuid[] DEFAULT '{}'::uuid[], p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_current uuid; v_missing int; v_mat int; v_demand uuid;
  v_target_fase public.onb_fase; v_now timestamptz := now(); v_open_history uuid;
  v_cur_nome text; v_tgt_nome text; v_situacao public.onb_situacao;
  v_hist_stage uuid; v_dept_origem uuid;
  v_target_inicia boolean; v_pipe_tem_gatilho boolean;
  -- encerramento da contagem (01/08)
  v_target_encerra boolean; v_enc_em timestamptz; v_enc_stage uuid;
  v_ordem_alvo int; v_ordem_enc int;
  v_reabre boolean := false; v_encerra_agora boolean := false;
BEGIN
  SELECT tenant_id, ticket_id, current_stage_id, situacao, demand_type_id
    INTO v_tenant, v_ticket, v_current, v_situacao, v_demand
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_situacao IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_terminal');
  END IF;

  IF NOT p_force AND v_current IS NOT NULL THEN
    SELECT count(*) INTO v_mat
      FROM public.onboarding_journey_checklist jc
      WHERE jc.journey_id = p_journey_id AND jc.stage_id = v_current;

    IF v_mat = 0 THEN
      SELECT count(*) INTO v_missing
        FROM public.onboarding_stage_checklist c
        WHERE c.stage_id = v_current AND c.ativo AND c.is_required
          AND public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand)
          AND NOT (c.id = ANY(p_completed_checklist_ids));
    ELSE
      SELECT
        (SELECT count(*) FROM public.onboarding_stage_checklist c
          LEFT JOIN public.onboarding_journey_checklist jc
            ON jc.journey_id = p_journey_id AND jc.source_item_id = c.id
          WHERE c.stage_id = v_current AND c.ativo AND c.is_required
            AND public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand)
            AND (jc.id IS NULL OR jc.done = false))
        +
        (SELECT count(*) FROM public.onboarding_journey_checklist jc
          WHERE jc.journey_id = p_journey_id AND jc.stage_id = v_current
            AND jc.origem <> 'etapa' AND jc.is_required AND jc.done = false)
      INTO v_missing;
    END IF;

    IF v_missing > 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'checklist_incompleto', 'faltando', v_missing);
    END IF;
  END IF;

  SELECT h.id, h.stage_id INTO v_open_history, v_hist_stage
    FROM public.onboarding_stage_history h
   WHERE h.journey_id = p_journey_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open_history IS NOT NULL THEN
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept_origem
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept_origem)
     WHERE id = v_open_history;
  END IF;

  SELECT p.fase INTO v_target_fase
    FROM public.onboarding_stages s JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
   WHERE s.id = p_target_stage_id;

  SELECT COALESCE(s.inicia_sla, false),
         EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = s.pipeline_id AND x.inicia_sla)
    INTO v_target_inicia, v_pipe_tem_gatilho
    FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

  v_target_inicia    := COALESCE(v_target_inicia, false);
  v_pipe_tem_gatilho := COALESCE(v_pipe_tem_gatilho, false);

  -- ── encerramento da contagem (01/08) ────────────────────────────────────────
  SELECT COALESCE(s.encerra_sla, false) INTO v_target_encerra
    FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;
  v_target_encerra := COALESCE(v_target_encerra, false);

  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
    FROM public.onboarding_journeys WHERE id = p_journey_id;

  v_ordem_alvo := public.fn_onb_stage_ordem(p_target_stage_id);
  v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
                       ELSE public.fn_onb_stage_ordem(v_enc_stage) END;

  v_encerra_agora := v_target_encerra AND v_enc_em IS NULL;

  -- Só reabre se o cartão RETROCEDEU. Avançar para as etapas seguintes mantém parado.
  v_reabre := v_enc_em IS NOT NULL
              AND NOT v_target_encerra
              AND v_ordem_enc IS NOT NULL
              AND v_ordem_alvo IS NOT NULL
              AND v_ordem_alvo < v_ordem_enc;

  UPDATE public.onboarding_journeys
     SET current_stage_id = p_target_stage_id,
         fase_atual = COALESCE(v_target_fase::text, fase_atual::text)::public.onb_fase_atual,
         situacao = CASE WHEN situacao='nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = CASE
           WHEN v_pipe_tem_gatilho AND v_target_inicia THEN COALESCE(sla_iniciado_em, v_now)
           WHEN v_pipe_tem_gatilho                     THEN sla_iniciado_em
           ELSE COALESCE(sla_iniciado_em, v_now)
         END,
         sla_encerrado_em = CASE
           WHEN v_target_encerra THEN COALESCE(sla_encerrado_em, v_now)
           WHEN v_reabre         THEN NULL
           ELSE sla_encerrado_em
         END,
         sla_encerrado_stage_id = CASE
           WHEN v_target_encerra THEN COALESCE(sla_encerrado_stage_id, p_target_stage_id)
           WHEN v_reabre         THEN NULL
           ELSE sla_encerrado_stage_id
         END
   WHERE id = p_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, p_target_stage_id);

  SELECT nome INTO v_cur_nome FROM public.onboarding_stages WHERE id = v_current;
  SELECT nome INTO v_tgt_nome FROM public.onboarding_stages WHERE id = p_target_stage_id;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_mudou_etapa', v_cur_nome, v_tgt_nome,
          'Etapa: ' || COALESCE(v_cur_nome,'—') || ' → ' || COALESCE(v_tgt_nome,'—'));

  -- Sem estes dois eventos não há como auditar depois por que o número do SLA mudou.
  IF v_encerra_agora THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_encerrado',
            'Contagem de SLA encerrada na etapa ' || COALESCE(v_tgt_nome, '—'));
  ELSIF v_reabre THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_reaberto',
            'Contagem de SLA reaberta: cartão voltou para ' || COALESCE(v_tgt_nome, '—'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id);
END $function$;
