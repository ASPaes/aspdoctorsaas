-- Encerrar/cancelar jornada tem que gravar duracao_util_minutos (12/08/2026).
--
-- conclude_onboarding_journey e cancel_onboarding_journey fechavam a última etapa
-- gravando só duracao_minutos. Toda jornada encerrada perdia a duração em horário
-- útil da etapa final: 28 linhas em 27 jornadas, 11.650 minutos úteis fora do
-- painel de SLA (6% de todo o histórico fechado). O cálculo é o mesmo de
-- move_onboarding_stage, inclusive a resolução do setor.

CREATE OR REPLACE FUNCTION public.cancel_onboarding_journey(p_journey_id uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_ticket uuid; v_now timestamptz := now(); v_open_hist uuid; v_open_pause uuid; v_fase public.onb_fase_atual; v_dept uuid;
BEGIN
  SELECT tenant_id, ticket_id, fase_atual INTO v_tenant, v_ticket, v_fase
    FROM public.onboarding_journeys WHERE id=p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_fase = 'concluido' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ja_terminal');
  END IF;

  -- fecha pausa aberta
  SELECT id INTO v_open_pause FROM public.onboarding_pauses
   WHERE journey_id=p_journey_id AND finalizada_em IS NULL LIMIT 1;
  IF v_open_pause IS NOT NULL THEN
    UPDATE public.onboarding_pauses
       SET finalizada_em=v_now, duracao_minutos=GREATEST(0, EXTRACT(EPOCH FROM (v_now-iniciada_em))/60)::int
     WHERE id=v_open_pause;
  END IF;

  -- fecha etapa aberta
  SELECT id INTO v_open_hist FROM public.onboarding_stage_history
   WHERE journey_id=p_journey_id AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;
  IF v_open_hist IS NOT NULL THEN
    -- Mesma resolução de setor que move_onboarding_stage: o do pipeline da etapa,
    -- caindo para o do ticket. Sem isto a etapa final da jornada some do painel
    -- de SLA em horário útil — eram 28 linhas e 11.650 minutos invisíveis.
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept
      FROM public.onboarding_stage_history h
      JOIN public.onboarding_stages s ON s.id = h.stage_id
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_ticket
     WHERE h.id = v_open_hist;

    UPDATE public.onboarding_stage_history
       SET saiu_em=v_now, duracao_minutos=GREATEST(0, EXTRACT(EPOCH FROM (v_now-entrou_em))/60)::int,
           duracao_util_minutos=public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id=v_open_hist;
  END IF;

  UPDATE public.onboarding_journeys
     SET situacao='cancelado', fase_atual='concluido', concluido_em=v_now,
         onboarding_concluido_em  = CASE WHEN v_fase='onboarding'  THEN COALESCE(onboarding_concluido_em,  v_now) ELSE onboarding_concluido_em  END,
         implantacao_concluida_em = CASE WHEN v_fase='implantacao' THEN COALESCE(implantacao_concluida_em, v_now) ELSE implantacao_concluida_em END
   WHERE id=p_journey_id;

  -- congela metricas da fase em que foi cancelada (espelha o conclude)
  IF v_fase = 'implantacao' THEN
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'implantacao');
  ELSIF v_fase = 'onboarding' THEN
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'onboarding');
  END IF;

  UPDATE public.support_tickets
     SET concluido_em=v_now, motivo_cancelamento=p_motivo
   WHERE id=v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_cancelado', COALESCE(p_motivo, 'Jornada cancelada'));

  RETURN jsonb_build_object('ok', true);
END $function$;

CREATE OR REPLACE FUNCTION public.conclude_onboarding_journey(p_journey_id uuid, p_go_live_real date DEFAULT NULL::date, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_ticket uuid; v_now timestamptz := now(); v_open_hist uuid; v_open_pause uuid; v_fase public.onb_fase_atual; v_dept uuid;
        v_abertos int; v_codigos text; v_motivo text;
BEGIN
  SELECT tenant_id, ticket_id, fase_atual INTO v_tenant, v_ticket, v_fase FROM public.onboarding_journeys WHERE id=p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  SELECT a.qtd, a.codigos INTO v_abertos, v_codigos FROM public.fn_onb_treinos_em_aberto(v_ticket) a;
  IF COALESCE(v_abertos, 0) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treinos_em_aberto',
                              'qtd', v_abertos, 'codigos', v_codigos);
  END IF;

  SELECT id INTO v_open_pause FROM public.onboarding_pauses WHERE journey_id=p_journey_id AND finalizada_em IS NULL LIMIT 1;
  IF v_open_pause IS NOT NULL THEN
    UPDATE public.onboarding_pauses SET finalizada_em=v_now, duracao_minutos=GREATEST(0, EXTRACT(EPOCH FROM (v_now-iniciada_em))/60)::int WHERE id=v_open_pause;
  END IF;
  SELECT id INTO v_open_hist FROM public.onboarding_stage_history WHERE journey_id=p_journey_id AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;
  IF v_open_hist IS NOT NULL THEN
    -- Mesma resolução de setor que move_onboarding_stage: o do pipeline da etapa,
    -- caindo para o do ticket. Sem isto a etapa final da jornada some do painel
    -- de SLA em horário útil — eram 28 linhas e 11.650 minutos invisíveis.
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept
      FROM public.onboarding_stage_history h
      JOIN public.onboarding_stages s ON s.id = h.stage_id
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_ticket
     WHERE h.id = v_open_hist;

    UPDATE public.onboarding_stage_history
       SET saiu_em=v_now, duracao_minutos=GREATEST(0, EXTRACT(EPOCH FROM (v_now-entrou_em))/60)::int,
           duracao_util_minutos=public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id=v_open_hist;
  END IF;

  UPDATE public.onboarding_journeys
     SET situacao='concluido', fase_atual='concluido', concluido_em=v_now,
         -- DEM-0269: encerrar no Onboarding não passou pela Implantação. Gravar a
         -- data aqui virava dado falso em relatório de implantação.
         implantacao_concluida_em = CASE WHEN v_fase = 'onboarding'
                                         THEN implantacao_concluida_em
                                         ELSE COALESCE(implantacao_concluida_em, v_now) END,
         go_live_real=COALESCE(p_go_live_real, go_live_real)
   WHERE id=p_journey_id;

  IF v_fase = 'implantacao' THEN
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'implantacao');
  ELSIF v_fase = 'onboarding' THEN
    UPDATE public.onboarding_journeys SET onboarding_concluido_em = COALESCE(onboarding_concluido_em, v_now) WHERE id=p_journey_id;
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'onboarding');
  END IF;

  UPDATE public.support_tickets SET concluido_em=v_now WHERE id=v_ticket AND concluido_em IS NULL;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_concluido',
          CASE WHEN v_fase = 'onboarding' THEN 'Jornada concluída no Onboarding, sem treinamento'
               ELSE 'Jornada concluida' END
          || COALESCE(' · ' || v_motivo, ''));
  RETURN jsonb_build_object('ok', true);
END $function$;

-- Backfill do que as duas RPCs deixaram para trás. Idempotente: só toca em linha
-- fechada e ainda sem duração útil, e usa exatamente a mesma resolução de setor.
UPDATE public.onboarding_stage_history h
   SET duracao_util_minutos = public.fn_onb_util_min(h.entrou_em, h.saiu_em, h.tenant_id, d.dept)
  FROM (
    SELECT h2.id,
           COALESCE(p.department_id, t.department_id) AS dept
      FROM public.onboarding_stage_history h2
      JOIN public.onboarding_stages s     ON s.id = h2.stage_id
      JOIN public.onboarding_pipelines p  ON p.id = s.pipeline_id
      LEFT JOIN public.onboarding_journeys j ON j.id = h2.journey_id
      LEFT JOIN public.support_tickets t     ON t.id = j.ticket_id
     WHERE h2.saiu_em IS NOT NULL
       AND h2.duracao_util_minutos IS NULL
  ) d
 WHERE d.id = h.id;
