-- DEM-0469: condutor de treino nao duplica participante nem cai no papel "Onboarding".
-- Base: definicoes de producao lidas em 28/09/2026. Grants preservados (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.create_onboarding_training(p_journey_id uuid, p_titulo text, p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone, p_conduzido_por uuid DEFAULT NULL::uuid, p_is_retreinamento boolean DEFAULT false, p_training_type_id uuid DEFAULT NULL::uuid, p_link text DEFAULT NULL::text, p_concluir_onboarding boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_cliente uuid; v_parent uuid; v_sub_ticket uuid; v_training uuid;
  v_seq smallint; v_code text; v_stage uuid;
BEGIN
  SELECT tenant_id, cliente_id, ticket_id
    INTO v_tenant, v_cliente, v_parent
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  SELECT s.seq, s.code INTO v_seq, v_code FROM public.next_sub_ticket_code(v_parent) s;
  v_stage := public.fn_onb_training_initial_stage(p_journey_id);

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, contexto, canal_origem, origem_criacao, parent_ticket_id, ticket_code, sub_seq)
  VALUES (v_tenant, v_cliente, p_titulo, 'onboarding', 'whatsapp', 'onboarding_treino', v_parent, v_code, v_seq)
  RETURNING id INTO v_sub_ticket;

  INSERT INTO public.onboarding_training_sessions (
    tenant_id, ticket_id, journey_id, titulo, status, agendado_para, conduzido_por, is_retreinamento, training_type_id, link_agendamento, current_stage_id
  ) VALUES (
    v_tenant, v_sub_ticket, p_journey_id, p_titulo,
    CASE WHEN p_agendado_para IS NOT NULL THEN 'agendado'::public.onb_treino_status ELSE 'previsto'::public.onb_treino_status END,
    p_agendado_para, p_conduzido_por, p_is_retreinamento, p_training_type_id, p_link, v_stage
  ) RETURNING id INTO v_training;

  IF v_stage IS NOT NULL THEN
    INSERT INTO public.onboarding_training_stage_history (tenant_id, training_id, journey_id, stage_id)
    VALUES (v_tenant, v_training, p_journey_id, v_stage);
  END IF;

  -- DEM-0469: quem ja participa da jornada, em qualquer papel, nao ganha 2a linha.
  -- Papel novo espelha o setor (DEM-0379); 'implantador' so de reserva, porque na
  -- Digi Office esse slug foi renomeado para "Onboarding".
  IF p_conduzido_por IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_participants op
                      WHERE op.ticket_id = v_parent AND op.user_id = p_conduzido_por) THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, p_conduzido_por,
            COALESCE(public.fn_onboarding_role_id_do_setor(v_tenant, p_conduzido_por),
                     public.fn_onboarding_role_id(v_tenant, 'implantador'))) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value, origem_sub_ticket_id)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_treino_criado', p_titulo, v_code, v_sub_ticket);

  IF p_concluir_onboarding THEN
    PERFORM public.advance_onboarding_to_implantacao(p_journey_id, false);
  END IF;

  RETURN v_training;
END $function$;

CREATE OR REPLACE FUNCTION public.update_onboarding_training(p_training_id uuid, p_titulo text DEFAULT NULL::text, p_training_type_id uuid DEFAULT NULL::uuid, p_conduzido_por uuid DEFAULT NULL::uuid, p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone, p_link text DEFAULT NULL::text, p_limpar_conduzido boolean DEFAULT false, p_limpar_agendado boolean DEFAULT false, p_limpar_link boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_parent uuid; v_code text; v_deleted timestamptz;
  v_titulo_ant text; v_cond_ant uuid; v_now timestamptz := now();
  v_titulo_novo text; v_cond_novo uuid; v_mudou text[] := '{}';
  v_stage uuid; v_ini uuid; v_status public.onb_treino_status;
BEGIN
  SELECT t.tenant_id, t.ticket_id, t.deleted_at, t.titulo, t.conduzido_por, t.status
    INTO v_tenant, v_ticket, v_deleted, v_titulo_ant, v_cond_ant, v_status
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;
  -- Desistência é desfecho fechado e ocupa a coluna de conclusão: editar data ou título
  -- ali dentro só produziria cartão incoerente. (O `cancelado` sai do quadro e sempre
  -- aceitou edição — não mexo nisso aqui.)
  IF v_status = 'desistencia'::public.onb_treino_status THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'treino_desistencia');
  END IF;

  v_titulo_novo := COALESCE(NULLIF(btrim(COALESCE(p_titulo, '')), ''), v_titulo_ant);
  v_cond_novo   := CASE WHEN p_limpar_conduzido THEN NULL ELSE COALESCE(p_conduzido_por, v_cond_ant) END;

  UPDATE public.onboarding_training_sessions
     SET titulo           = v_titulo_novo,
         training_type_id = COALESCE(p_training_type_id, training_type_id),
         conduzido_por    = v_cond_novo,
         agendado_para    = CASE WHEN p_limpar_agendado THEN NULL
                                 ELSE COALESCE(p_agendado_para, agendado_para) END,
         link_agendamento = CASE WHEN p_limpar_link THEN NULL
                                 ELSE COALESCE(NULLIF(btrim(COALESCE(p_link,'')),''), link_agendamento) END,
         status           = CASE
           WHEN status IN ('previsto'::public.onb_treino_status, 'no_show'::public.onb_treino_status)
                AND NOT p_limpar_agendado
                AND COALESCE(p_agendado_para, agendado_para) IS NOT NULL
             THEN 'agendado'::public.onb_treino_status
           ELSE status END,
         updated_at       = v_now
   WHERE id = p_training_id;

  UPDATE public.support_tickets
     SET assunto = v_titulo_novo
   WHERE id = v_ticket AND assunto IS DISTINCT FROM v_titulo_novo;

  IF v_cond_novo IS NOT NULL AND v_cond_novo IS DISTINCT FROM v_cond_ant THEN
    SELECT tk.parent_ticket_id INTO v_parent FROM public.support_tickets tk WHERE tk.id = v_ticket;
    -- DEM-0469: mesma regra do create_onboarding_training.
    IF NOT EXISTS (SELECT 1 FROM public.onboarding_participants op
                    WHERE op.ticket_id = v_parent AND op.user_id = v_cond_novo) THEN
      INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
      VALUES (v_tenant, v_parent, v_cond_novo,
              COALESCE(public.fn_onboarding_role_id_do_setor(v_tenant, v_cond_novo),
                       public.fn_onboarding_role_id(v_tenant, 'implantador')))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  IF v_titulo_novo IS DISTINCT FROM v_titulo_ant THEN v_mudou := array_append(v_mudou, 'título'); END IF;
  IF v_cond_novo   IS DISTINCT FROM v_cond_ant   THEN v_mudou := array_append(v_mudou, 'responsável'); END IF;
  IF p_agendado_para IS NOT NULL OR p_limpar_agendado THEN v_mudou := array_append(v_mudou, 'data'); END IF;
  IF p_training_type_id IS NOT NULL THEN v_mudou := array_append(v_mudou, 'tipo'); END IF;
  IF p_link IS NOT NULL OR p_limpar_link THEN v_mudou := array_append(v_mudou, 'link'); END IF;

  IF array_length(v_mudou, 1) IS NOT NULL THEN
    SELECT tk.parent_ticket_id, tk.ticket_code INTO v_parent, v_code
      FROM public.support_tickets tk WHERE tk.id = v_ticket;
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, old_value, new_value, content, origem_sub_ticket_id)
    VALUES (v_tenant, COALESCE(v_parent, v_ticket), auth.uid(), 'onboarding_treino_editado',
            v_titulo_ant, v_titulo_novo,
            COALESCE(v_code, v_titulo_novo) || ' · ' || array_to_string(v_mudou, ', '), v_ticket);
  END IF;

  -- Remarcar de dentro da etapa de retorno devolve o cartão para onde o treino nasce.
  -- Agendar em qualquer outra etapa continua manual (decisão do owner, 11/08).
  IF NOT p_limpar_agendado AND p_agendado_para IS NOT NULL THEN
    SELECT t.current_stage_id INTO v_stage
      FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

    SELECT ini.id INTO v_ini
      FROM public.onboarding_stages atual
      JOIN public.onboarding_stages ini ON ini.pipeline_id = atual.pipeline_id
                                       AND ini.is_initial AND ini.ativo
     WHERE atual.id = v_stage AND atual.retorno_no_show
     LIMIT 1;

    IF v_ini IS NOT NULL AND v_ini IS DISTINCT FROM v_stage THEN
      PERFORM public.move_onboarding_training_stage(p_training_id, v_ini);
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'mudou', to_jsonb(v_mudou));
END $function$;
