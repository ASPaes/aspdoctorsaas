-- Ao concluir o onboarding, a responsabilidade passa automaticamente para o
-- implantador — que é o "Conduzido por" do treino mais recente da jornada —
-- com o motivo "Finalização da etapa do onboarding".
--
-- Regra do owner (26/07/2026): "ao marcar o treino é definido o implantador, e
-- esse recebe a responsabilidade". Se não der para resolver, mantém quem está.

-- ==========================================================================
-- 1. Backfill: quem entrou na equipe como Especialista por ter conduzido treino
--    passa a Implantador, que é o papel que de fato exerce.
-- ==========================================================================

-- 1a. Se a pessoa JÁ é implantador no mesmo ticket, a linha de especialista é
--     duplicata — remove, senão o UPDATE violaria a unique (ticket,user,role).
DELETE FROM public.onboarding_participants op
 USING public.onboarding_participant_roles r,
       public.onboarding_journeys j
 WHERE r.id = op.role_id
   AND r.slug = 'especialista'
   AND j.ticket_id = op.ticket_id
   AND EXISTS (SELECT 1 FROM public.onboarding_training_sessions ts
                WHERE ts.journey_id = j.id AND ts.conduzido_por = op.user_id)
   AND EXISTS (SELECT 1 FROM public.onboarding_participants outra
                JOIN public.onboarding_participant_roles r2 ON r2.id = outra.role_id
               WHERE outra.ticket_id = op.ticket_id
                 AND outra.user_id = op.user_id
                 AND r2.slug = 'implantador');

-- 1b. O resto vira implantador.
UPDATE public.onboarding_participants op
   SET role_id = public.fn_onboarding_role_id(op.tenant_id, 'implantador')
  FROM public.onboarding_participant_roles r,
       public.onboarding_journeys j
 WHERE r.id = op.role_id
   AND r.slug = 'especialista'
   AND j.ticket_id = op.ticket_id
   AND EXISTS (SELECT 1 FROM public.onboarding_training_sessions ts
                WHERE ts.journey_id = j.id AND ts.conduzido_por = op.user_id);

-- 1c. A coluna legada `papel` acompanha, para continuar servindo de rollback
--     honesto enquanto não for dropada. Papel sem correspondente no enum
--     (criado pelo tenant) fica NULL — é o esperado.
UPDATE public.onboarding_participants op
   SET papel = r.slug::public.onb_participante_papel
  FROM public.onboarding_participant_roles r
 WHERE r.id = op.role_id
   AND r.slug IS NOT NULL
   AND op.papel IS DISTINCT FROM r.slug::public.onb_participante_papel;

UPDATE public.onboarding_participants op
   SET papel = NULL
  FROM public.onboarding_participant_roles r
 WHERE r.id = op.role_id AND r.slug IS NULL AND op.papel IS NOT NULL;

-- ==========================================================================
-- 2. As 2 funções abaixo são a definição corrente do banco com alteração mínima:
--      create_onboarding_training        -> condutor entra como Implantador
--      advance_onboarding_to_implantacao -> transfere a responsabilidade
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.create_onboarding_training(p_journey_id uuid, p_titulo text, p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone, p_conduzido_por uuid DEFAULT NULL::uuid, p_is_retreinamento boolean DEFAULT false, p_training_type_id uuid DEFAULT NULL::uuid, p_link text DEFAULT NULL::text, p_concluir_onboarding boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cliente uuid; v_parent uuid; v_sub_ticket uuid; v_training uuid;
BEGIN
  SELECT tenant_id, cliente_id, ticket_id
    INTO v_tenant, v_cliente, v_parent
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, canal_origem, origem_criacao, parent_ticket_id)
  VALUES (v_tenant, v_cliente, p_titulo, 'onboarding', 'whatsapp', 'onboarding_treino', v_parent)
  RETURNING id INTO v_sub_ticket;

  INSERT INTO public.onboarding_training_sessions (
    tenant_id, ticket_id, journey_id, titulo, status, agendado_para, conduzido_por, is_retreinamento, training_type_id, link_agendamento
  ) VALUES (
    v_tenant, v_sub_ticket, p_journey_id, p_titulo,
    CASE WHEN p_agendado_para IS NOT NULL THEN 'agendado'::public.onb_treino_status ELSE 'previsto'::public.onb_treino_status END,
    p_agendado_para, p_conduzido_por, p_is_retreinamento, p_training_type_id, p_link
  ) RETURNING id INTO v_training;

  -- Quem conduz o treino e o implantador da jornada: e ele que assume a
  -- responsabilidade quando o onboarding e concluido.
  IF p_conduzido_por IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, p_conduzido_por, public.fn_onboarding_role_id(v_tenant, 'implantador')) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_treino_criado', p_titulo);

  -- Só conclui o onboarding e vai pra implantação se o usuário pediu explicitamente.
  IF p_concluir_onboarding THEN
    PERFORM public.advance_onboarding_to_implantacao(p_journey_id, false);
  END IF;

  RETURN v_training;
END $function$;

CREATE OR REPLACE FUNCTION public.advance_onboarding_to_implantacao(p_journey_id uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_parent uuid; v_fase public.onb_fase_atual; v_pipe_imp uuid;
  v_cur uuid; v_is_final boolean; v_first_imp uuid; v_open_hist uuid; v_now timestamptz := now();
  v_novo_resp uuid; v_resp_atual uuid;
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

  -- fecha a etapa aberta atual (onboarding)
  SELECT id INTO v_open_hist FROM public.onboarding_stage_history
   WHERE journey_id = p_journey_id AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;
  IF v_open_hist IS NOT NULL THEN
    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now, duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int
     WHERE id = v_open_hist;
  END IF;

  UPDATE public.onboarding_journeys
     SET fase_atual = 'implantacao', current_stage_id = v_first_imp,
         situacao = CASE WHEN situacao = 'nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = COALESCE(sla_iniciado_em, v_now),
         onboarding_concluido_em = COALESCE(onboarding_concluido_em, v_now),
         implantacao_iniciada_em = COALESCE(implantacao_iniciada_em, v_now)
   WHERE id = p_journey_id;

  PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'onboarding');

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, v_first_imp);

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_fase_implantacao',
          'Onboarding concluído · Implantação iniciada');

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
