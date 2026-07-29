-- Entrega C / Task 1 — avanço de jornada genérico e go-live que respeita a configuração.
--
-- advance_onboarding_to_implantacao continua sendo a dona do par onboarding →
-- implantação (ela transfere o responsável para quem conduziu o treino). A genérica
-- DELEGA nesse caso, em vez de duplicar a regra.

-- Próxima jornada ativa depois da atual, na ordem do cadastro.
CREATE OR REPLACE FUNCTION public.fn_onboarding_next_phase(p_journey_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT f.id
    FROM public.onboarding_journeys j
    JOIN public.onboarding_phases atual ON atual.id = j.current_phase_id
    JOIN public.onboarding_phases f
      ON f.tenant_id = j.tenant_id AND f.ativo AND f.position > atual.position
   WHERE j.id = p_journey_id
   ORDER BY f.position
   LIMIT 1;
$function$;

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

  -- Os marcos legados continuam sendo mantidos enquanto vw_onboarding_journeys existir.
  UPDATE public.onboarding_journeys
     SET current_phase_id = v_tgt_phase,
         current_stage_id = v_first,
         situacao = CASE WHEN situacao = 'nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = COALESCE(sla_iniciado_em, v_now),
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

  RETURN jsonb_build_object('ok', true, 'stage_id', v_first, 'phase_id', v_tgt_phase, 'fase', v_tgt_nome);
END $function$;

-- Go-live: grava a data e decide o que fazer em seguida a partir da CONFIGURAÇÃO.
-- Sem jornada seguinte (o caso de hoje), conclui — comportamento idêntico ao atual.
-- Com jornada seguinte (Acompanhamento ligado), o sistema entra no ar e a jornada
-- continua viva até o acompanhamento fechar.
CREATE OR REPLACE FUNCTION public.journey_go_live(
  p_journey_id uuid,
  p_go_live_real date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_next uuid; v_res jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  v_next := public.fn_onboarding_next_phase(p_journey_id);

  IF v_next IS NULL THEN
    RETURN public.conclude_onboarding_journey(p_journey_id, p_go_live_real)
           || jsonb_build_object('concluiu', true);
  END IF;

  UPDATE public.onboarding_journeys
     SET go_live_real = COALESCE(p_go_live_real, go_live_real, current_date)
   WHERE id = p_journey_id;

  v_res := public.advance_onboarding_phase(p_journey_id, v_next, true);
  RETURN v_res || jsonb_build_object('concluiu', false);
END $function$;

REVOKE ALL ON FUNCTION public.fn_onboarding_next_phase(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_onboarding_phase(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.journey_go_live(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_next_phase(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_onboarding_phase(uuid, uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.journey_go_live(uuid, date) TO authenticated, service_role;
