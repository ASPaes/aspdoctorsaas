-- Estorno da conclusão do treinamento ao sair da etapa final.
--
-- `move_onboarding_training_stage` só sabia ir para frente: cair numa etapa is_final
-- gravava status='realizado' + realizado_em, e sair dela não desfazia nada. O cartão
-- voltava para "Pendente Agendar" ainda com o selo "realizado", o cartão do ticket pai
-- continuava "4 de 4 concluídos" (o contador conta por status, não por coluna) e —
-- o pior — `fn_onb_treinos_em_aberto` ignora quem está 'realizado', então o
-- `journey_go_live` liberava a jornada com treino aberto. Medido em 27/08/2026 na
-- TK-2026-0018: go-live às 21:04:36 com 2 treinos parados fora da etapa final.
--
-- O estorno é DELIBERADAMENTE estreito: só quando o cartão SAI de uma etapa final.
-- Estornar em qualquer movimento desfaria a chamada de quem marca o treino realizado
-- pelo detalhe da jornada sem mover o cartão — 7 casos legítimos na base hoje.
CREATE OR REPLACE FUNCTION public.move_onboarding_training_stage(p_training_id uuid, p_target_stage_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_journey uuid; v_ticket uuid; v_parent uuid; v_current uuid;
  v_status public.onb_treino_status; v_deleted timestamptz;
  v_now timestamptz := now(); v_open uuid; v_hist_stage uuid; v_dept uuid;
  v_cur_nome text; v_tgt_nome text; v_is_final boolean; v_titulo text; v_code text;
  v_pendente boolean := false;
  v_from_final boolean := false; v_estornou boolean := false;
BEGIN
  SELECT t.tenant_id, t.journey_id, t.ticket_id, t.current_stage_id, t.status, t.deleted_at, t.titulo
    INTO v_tenant, v_journey, v_ticket, v_current, v_status, v_deleted, v_titulo
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  IF v_status = 'cancelado'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_cancelado');
  END IF;

  SELECT s.id IS NOT NULL INTO v_is_final FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;
  IF NOT COALESCE(v_is_final, false) THEN RAISE EXCEPTION 'etapa destino nao encontrada'; END IF;

  SELECT h.id, h.stage_id INTO v_open, v_hist_stage
    FROM public.onboarding_training_stage_history h
   WHERE h.training_id = p_training_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open IS NOT NULL THEN
    SELECT COALESCE(p.department_id, tk.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets tk ON tk.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_training_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open;
  END IF;

  SELECT COALESCE(s.is_final, false) INTO v_is_final
    FROM public.onboarding_stages s WHERE s.id = p_target_stage_id;

  -- Etapa de ORIGEM: o estorno só vale para quem estava na coluna de conclusão.
  SELECT COALESCE(s.is_final, false) INTO v_from_final
    FROM public.onboarding_stages s WHERE s.id = v_current;
  v_from_final := COALESCE(v_from_final, false);

  v_estornou := (NOT v_is_final) AND v_from_final
                AND v_status = 'realizado'::public.onb_treino_status;

  UPDATE public.onboarding_training_sessions
     SET current_stage_id = p_target_stage_id,
         status = CASE
           WHEN v_is_final AND status <> 'realizado'::public.onb_treino_status
             THEN 'realizado'::public.onb_treino_status
           WHEN v_estornou
             THEN CASE WHEN agendado_para IS NOT NULL
                       THEN 'agendado'::public.onb_treino_status
                       ELSE 'previsto'::public.onb_treino_status END
           ELSE status END,
         realizado_em = CASE
           WHEN v_is_final THEN COALESCE(realizado_em, v_now)
           WHEN v_estornou THEN NULL
           ELSE realizado_em END,
         updated_at = v_now
   WHERE id = p_training_id;

  INSERT INTO public.onboarding_training_stage_history (tenant_id, training_id, journey_id, stage_id)
  VALUES (v_tenant, p_training_id, v_journey, p_target_stage_id);

  SELECT nome INTO v_cur_nome FROM public.onboarding_stages WHERE id = v_current;
  SELECT nome INTO v_tgt_nome FROM public.onboarding_stages WHERE id = p_target_stage_id;
  SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
    FROM public.support_tickets tk WHERE tk.id = v_ticket;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
  VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_movido',
          v_cur_nome, v_tgt_nome,
          COALESCE(v_code, v_titulo) || ' → ' || COALESCE(v_tgt_nome, '—')
            || CASE WHEN v_estornou THEN ' (conclusão estornada)' ELSE '' END, v_ticket);

  -- Fechou o cartão com a chamada em aberto: avisa, não impede.
  IF v_is_final THEN
    SELECT count(*) = 0 OR count(*) FILTER (WHERE presente IS NULL) > 0
      INTO v_pendente
      FROM public.onboarding_training_participants WHERE training_id = p_training_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', p_target_stage_id, 'realizado', v_is_final,
                            'estornado', v_estornou,
                            'chamada_pendente', COALESCE(v_pendente, false));
END $function$;
