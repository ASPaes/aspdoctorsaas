-- Transferência definitiva do responsável de uma jornada de onboarding.
-- Motivo é obrigatório. O responsável antigo continua na equipe (só perde a
-- estrela) — decisão do owner, ver spec 2026-07-25.

CREATE OR REPLACE FUNCTION public.transfer_onboarding_responsavel(
  p_journey_id   uuid,
  p_novo_user_id uuid,
  p_motivo       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant     uuid;
  v_ticket     uuid;
  v_atual      uuid;
  v_motivo     text := btrim(coalesce(p_motivo, ''));
  v_impl       uuid;
  v_nome_novo  text;
  v_nome_atual text;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.responsavel_user_id
    INTO v_tenant, v_ticket, v_atual
    FROM public.onboarding_journeys j
   WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Jornada não encontrada.';
  END IF;

  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'Sem permissão para alterar esta jornada.';
  END IF;

  IF v_motivo = '' THEN
    RAISE EXCEPTION 'O motivo da transferência é obrigatório.';
  END IF;

  IF p_novo_user_id IS NULL THEN
    RAISE EXCEPTION 'Informe o novo responsável.';
  END IF;

  IF p_novo_user_id = v_atual THEN
    RAISE EXCEPTION 'Este usuário já é o responsável pela jornada.';
  END IF;

  PERFORM 1 FROM public.profiles p
   WHERE p.user_id = p_novo_user_id AND p.tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'O usuário escolhido não pertence à empresa desta jornada.';
  END IF;

  -- fecha o período aberto (zero linhas se a jornada ainda não tinha responsável)
  UPDATE public.onboarding_responsavel_history
     SET ate = now()
   WHERE journey_id = p_journey_id AND ate IS NULL;

  INSERT INTO public.onboarding_responsavel_history
    (tenant_id, journey_id, user_id, de, motivo, transferido_por)
  VALUES
    (v_tenant, p_journey_id, p_novo_user_id, now(), v_motivo, auth.uid());

  UPDATE public.onboarding_journeys
     SET responsavel_user_id = p_novo_user_id,
         updated_at = now()
   WHERE id = p_journey_id;

  -- garante o novo responsável na equipe; o antigo permanece
  v_impl := public.fn_onboarding_role_id(v_tenant, 'implantador');
  INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
  VALUES (v_tenant, v_ticket, p_novo_user_id, v_impl)
  ON CONFLICT DO NOTHING;

  SELECT f.nome INTO v_nome_novo
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = p_novo_user_id AND p.tenant_id = v_tenant;

  SELECT f.nome INTO v_nome_atual
    FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
   WHERE p.user_id = v_atual AND p.tenant_id = v_tenant;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (
    v_tenant, v_ticket, auth.uid(), 'onboarding_responsavel_transferido',
    'Responsável: ' || coalesce(v_nome_atual, 'sem responsável') ||
    ' → ' || coalesce(v_nome_novo, 'usuário') || ' · ' || v_motivo
  );

  RETURN jsonb_build_object(
    'ok', true,
    'responsavel_user_id', p_novo_user_id,
    'responsavel_nome', coalesce(v_nome_novo, 'usuário')
  );
END $$;

REVOKE ALL ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_onboarding_responsavel(uuid, uuid, text) TO authenticated, service_role;

-- ==========================================================================
-- As 2 funções abaixo são a definição corrente do banco com alteração mínima:
--   create_onboarding_journey  -> passa a gravar responsavel_user_id e abrir o
--                                 primeiro período do histórico;
--   fn_snapshot_onboarding_phase -> lê o responsável da coluna da jornada em vez
--                                 de derivar do participante implantador.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.create_onboarding_journey(p_tenant_id uuid, p_cliente_id uuid, p_assunto text, p_produto_id bigint DEFAULT NULL::bigint, p_data_inicio_planejado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_go_live_previsto date DEFAULT NULL::date, p_implantador_user_id uuid DEFAULT NULL::uuid, p_descricao text DEFAULT NULL::text, p_demand_type_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid; v_journey_id uuid; v_pipe_onb uuid; v_pipe_imp uuid; v_first_stage uuid;
  v_implantador uuid;
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;
  v_implantador := COALESCE(p_implantador_user_id, auth.uid());

  -- pipeline ONBOARDING: prioriza match de produto, MAS so entre os que tem etapas.
  SELECT p.id INTO v_pipe_onb FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='onboarding' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  -- pipeline IMPLANTACAO (mesma regra)
  SELECT p.id INTO v_pipe_imp FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='implantacao' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  -- primeira etapa do pipeline escolhido
  SELECT id INTO v_first_stage FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe_onb AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  -- guard: sem etapa configurada em lugar nenhum -> erro claro (evita jornada orfa invisivel)
  IF v_first_stage IS NULL THEN
    RAISE EXCEPTION 'Nenhum pipeline de onboarding com etapas configurado para este tenant/produto. Configure as etapas antes de criar a jornada.';
  END IF;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao, unidade_base_id, department_id)
  VALUES (p_tenant_id, p_cliente_id, p_assunto, p_descricao, 'onboarding', 'whatsapp', 'onboarding_manual', p_unidade_base_id, p_department_id)
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.onboarding_journeys (
    tenant_id, ticket_id, cliente_id, produto_id, demand_type_id,
    pipeline_onboarding_id, pipeline_implantacao_id, current_stage_id,
    fase_atual, situacao, data_inicio_planejado, go_live_previsto, sla_iniciado_em
  ) VALUES (
    p_tenant_id, v_ticket_id, p_cliente_id, p_produto_id, p_demand_type_id,
    v_pipe_onb, v_pipe_imp, v_first_stage, 'onboarding', 'nao_iniciado',
    p_data_inicio_planejado, p_go_live_previsto,
    CASE WHEN p_data_inicio_planejado IS NOT NULL AND p_data_inicio_planejado <= now() THEN now() ELSE NULL END
  ) RETURNING id INTO v_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (p_tenant_id, v_journey_id, v_first_stage);

  IF v_implantador IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (p_tenant_id, v_ticket_id, v_implantador, public.fn_onboarding_role_id(p_tenant_id, 'implantador')) ON CONFLICT DO NOTHING;

    UPDATE public.onboarding_journeys
       SET responsavel_user_id = v_implantador
     WHERE id = v_journey_id;

    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de)
    VALUES (p_tenant_id, v_journey_id, v_implantador, now());
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_criado', 'Jornada de onboarding criada');

  RETURN v_journey_id;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_snapshot_onboarding_phase(p_journey_id uuid, p_fase onb_fase)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_ini timestamptz; v_fim timestamptz;
  v_corrido int; v_pausado int; v_resp uuid;
BEGIN
  SELECT j.tenant_id, j.ticket_id,
    CASE WHEN p_fase='onboarding' THEN COALESCE(j.sla_iniciado_em, j.data_inicio_planejado)
         ELSE j.implantacao_iniciada_em END,
    CASE WHEN p_fase='onboarding' THEN j.onboarding_concluido_em
         ELSE COALESCE(j.implantacao_concluida_em, j.concluido_em) END
    INTO v_tenant, v_ticket, v_ini, v_fim
  FROM public.onboarding_journeys j WHERE j.id = p_journey_id;

  IF v_ini IS NULL THEN v_corrido := 0;
  ELSE v_corrido := GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(v_fim, now()) - v_ini))/60)::int;
  END IF;

  -- pausas dessa fase (cast por texto: os dois enums compartilham os labels)
  SELECT COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (COALESCE(finalizada_em, now()) - iniciada_em))/60)),0)::int
    INTO v_pausado FROM public.onboarding_pauses
   WHERE journey_id=p_journey_id AND fase::text = p_fase::text;

  SELECT responsavel_user_id INTO v_resp FROM public.onboarding_journeys
   WHERE id = p_journey_id;

  INSERT INTO public.onboarding_phase_metrics
    (tenant_id, journey_id, fase, iniciada_em, concluida_em, sla_corrido_min, sla_util_min, pausado_min, responsavel_user_id)
  VALUES (v_tenant, p_journey_id, p_fase, v_ini, v_fim, v_corrido, GREATEST(0, v_corrido - v_pausado), v_pausado, v_resp)
  ON CONFLICT (journey_id, fase) DO UPDATE SET
    iniciada_em=EXCLUDED.iniciada_em, concluida_em=EXCLUDED.concluida_em,
    sla_corrido_min=EXCLUDED.sla_corrido_min, sla_util_min=EXCLUDED.sla_util_min,
    pausado_min=EXCLUDED.pausado_min, responsavel_user_id=EXCLUDED.responsavel_user_id;
END $function$;
