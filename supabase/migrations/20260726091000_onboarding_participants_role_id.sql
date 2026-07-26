-- onboarding_participants deixa de usar o enum onb_participante_papel e passa a
-- referenciar onboarding_participant_roles. A coluna `papel` fica nullable e sem
-- uso; dropar a coluna e o enum é passo posterior, após validação em produção.

ALTER TABLE public.onboarding_participants
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.onboarding_participant_roles(id);

UPDATE public.onboarding_participants op
   SET role_id = r.id
  FROM public.onboarding_participant_roles r
 WHERE r.tenant_id = op.tenant_id
   AND r.slug = op.papel::text
   AND op.role_id IS NULL;

-- Falha alto e cedo se sobrou alguém sem papel — melhor abortar que gravar lixo.
DO $$
DECLARE v_qtd int;
BEGIN
  SELECT count(*) INTO v_qtd FROM public.onboarding_participants WHERE role_id IS NULL;
  IF v_qtd > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % participante(s) sem role_id. Migration abortada.', v_qtd;
  END IF;
END $$;

ALTER TABLE public.onboarding_participants ALTER COLUMN role_id SET NOT NULL;
ALTER TABLE public.onboarding_participants ALTER COLUMN papel  DROP NOT NULL;

-- O DEFAULT precisa cair junto. Sem isso, toda linha nova (o front não manda
-- `papel`) nasceria com papel='implantador' mesmo com role_id de outro papel —
-- a coluna legada ficaria mentindo até ser dropada.
ALTER TABLE public.onboarding_participants ALTER COLUMN papel DROP DEFAULT;

ALTER TABLE public.onboarding_participants
  DROP CONSTRAINT IF EXISTS onboarding_participants_ticket_id_user_id_papel_key;

-- Idempotente de propósito: o arquivo inteiro pode ser reaplicado sem estourar.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.onboarding_participants'::regclass
       AND conname  = 'onboarding_participants_ticket_user_role_key'
  ) THEN
    ALTER TABLE public.onboarding_participants
      ADD CONSTRAINT onboarding_participants_ticket_user_role_key UNIQUE (ticket_id, user_id, role_id);
  END IF;
END $$;

-- Resolve o papel padrão de um tenant pelo slug, que é imutável.
-- Sobrevive ao tenant renomear "Vendedor" para "Consultor Comercial".
CREATE OR REPLACE FUNCTION public.fn_onboarding_role_id(p_tenant_id uuid, p_slug text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.onboarding_participant_roles
   WHERE tenant_id = p_tenant_id AND slug = p_slug;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Papel padrão "%" não encontrado para o tenant %.', p_slug, p_tenant_id;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_role_id(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_role_id(uuid, text) TO authenticated, service_role;

-- ==========================================================================
-- As 3 RPCs abaixo são a definição corrente do banco, com uma única alteração:
-- o INSERT de participante passa de `papel` (enum) para `role_id` resolvido
-- por slug. Nada mais nos corpos mudou.
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
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_criado', 'Jornada de onboarding criada');

  RETURN v_journey_id;
END $function$;

CREATE OR REPLACE FUNCTION public.return_to_vendor(p_journey_id uuid, p_vendedor_user_id uuid, p_reason_id uuid DEFAULT NULL::uuid, p_motivo_texto text DEFAULT NULL::text, p_pausar_sla boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_ticket uuid; v_ret uuid; v_reason_nome text;
BEGIN
  SELECT tenant_id, ticket_id INTO v_tenant, v_ticket FROM public.onboarding_journeys WHERE id=p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  INSERT INTO public.onboarding_vendor_returns (tenant_id, journey_id, vendedor_user_id, reason_id, motivo_texto, criado_por)
  VALUES (v_tenant, p_journey_id, p_vendedor_user_id, p_reason_id, p_motivo_texto, auth.uid())
  RETURNING id INTO v_ret;

  -- garante vendedor como participante
  IF p_vendedor_user_id IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_ticket, p_vendedor_user_id, public.fn_onboarding_role_id(v_tenant, 'vendedor')) ON CONFLICT DO NOTHING;
  END IF;

  -- opcional: pausa o SLA (impede continuidade)
  IF p_pausar_sla AND NOT EXISTS (SELECT 1 FROM public.onboarding_pauses WHERE journey_id=p_journey_id AND finalizada_em IS NULL) THEN
    SELECT nome INTO v_reason_nome FROM public.onboarding_vendor_return_reasons WHERE id=p_reason_id;
    INSERT INTO public.onboarding_pauses (tenant_id, journey_id, motivo_texto, criada_por)
    VALUES (v_tenant, p_journey_id, 'Retorno ao vendedor: '||COALESCE(v_reason_nome, p_motivo_texto, 'sem motivo'), auth.uid());
    UPDATE public.onboarding_journeys SET situacao='parado' WHERE id=p_journey_id;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_retorno_vendedor', COALESCE(p_motivo_texto,'Retornado ao vendedor'));

  RETURN v_ret;
END $function$;

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

  IF p_conduzido_por IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_parent, p_conduzido_por, public.fn_onboarding_role_id(v_tenant, 'especialista')) ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_treino_criado', p_titulo);

  -- Só conclui o onboarding e vai pra implantação se o usuário pediu explicitamente.
  IF p_concluir_onboarding THEN
    PERFORM public.advance_onboarding_to_implantacao(p_journey_id, false);
  END IF;

  RETURN v_training;
END $function$;
