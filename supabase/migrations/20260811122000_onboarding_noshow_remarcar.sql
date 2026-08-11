-- No-show devolve o treino para a fila de agendamento (11/08/2026) — etapa 3 de 4.
--
-- Spec: docs/superpowers/specs/2026-08-11-onboarding-noshow-volta-para-agendar-design.md
--
-- Base: definição VIVA (produção md5 9b00d1b9…, local b671e0d7… — a diferença entre as
-- duas era só comentário, a lógica é a mesma). Dois acréscimos, ambos no fim:
--
--   1. Remarcar de dentro da etapa de retorno devolve o cartão para a etapa onde o
--      treino nasce (is_initial). Agendar em qualquer outra etapa continua manual —
--      decisão do owner em 11/08. Sem isto, todo no-show remarcado reproduziria ao
--      contrário o incômodo original: cartão com tarja azul parado na fila de agendar.
--   2. O CASE do status passa a aceitar 'no_show' como origem. Os treinos que já estão
--      com status='no_show' (6 em produção, anteriores a esta entrega) continuariam
--      'no_show' depois de remarcados, e a tarja do quadro — que agora exige
--      status='agendado' — nunca voltaria para eles.

CREATE OR REPLACE FUNCTION public.update_onboarding_training(
  p_training_id uuid,
  p_titulo text DEFAULT NULL::text,
  p_training_type_id uuid DEFAULT NULL::uuid,
  p_conduzido_por uuid DEFAULT NULL::uuid,
  p_agendado_para timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_link text DEFAULT NULL::text,
  p_limpar_conduzido boolean DEFAULT false,
  p_limpar_agendado boolean DEFAULT false,
  p_limpar_link boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_parent uuid; v_code text; v_deleted timestamptz;
  v_titulo_ant text; v_cond_ant uuid; v_now timestamptz := now();
  v_titulo_novo text; v_cond_novo uuid; v_mudou text[] := '{}';
  v_stage uuid; v_ini uuid;
BEGIN
  SELECT t.tenant_id, t.ticket_id, t.deleted_at, t.titulo, t.conduzido_por
    INTO v_tenant, v_ticket, v_deleted, v_titulo_ant, v_cond_ant
    FROM public.onboarding_training_sessions t WHERE t.id = p_training_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'treino nao encontrado'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;
  IF v_deleted IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'treino_excluido'); END IF;

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

  -- o assunto do sub-ticket acompanha o título
  UPDATE public.support_tickets
     SET assunto = v_titulo_novo
   WHERE id = v_ticket AND assunto IS DISTINCT FROM v_titulo_novo;

  -- quem passa a conduzir vira implantador da jornada
  IF v_cond_novo IS NOT NULL AND v_cond_novo IS DISTINCT FROM v_cond_ant THEN
    SELECT tk.parent_ticket_id INTO v_parent FROM public.support_tickets tk WHERE tk.id = v_ticket;
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, v_cond_novo, public.fn_onboarding_role_id(v_tenant, 'implantador'))
    ON CONFLICT DO NOTHING;
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
