-- Devolve o motor de distribuição a create_onboarding_journey.
--
-- O que aconteceu: a migration 20260726100000 (distribuição) e a 20260726120000
-- (SLA em horário útil) recriam a MESMA função. A de SLA foi escrita a partir da
-- versão que existia em produção ANTES da distribuição ser aplicada, então ao
-- subir ela apagou o motor: `fn_onboarding_pick_assignee` continuou existindo,
-- mas ninguém mais a chamava. Efeito visível: a aba Distribuição configurava o
-- rodízio e a criação de jornada ignorava, voltando ao "quem cria vira dono".
--
-- Esta migration é o merge das duas: mantém a lógica de etapa-gatilho do SLA e
-- restaura a escolha automática do responsável.

CREATE OR REPLACE FUNCTION public.create_onboarding_journey(p_tenant_id uuid, p_cliente_id uuid, p_assunto text, p_produto_id bigint DEFAULT NULL::bigint, p_data_inicio_planejado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_go_live_previsto date DEFAULT NULL::date, p_implantador_user_id uuid DEFAULT NULL::uuid, p_descricao text DEFAULT NULL::text, p_demand_type_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_department_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid; v_journey_id uuid; v_pipe_onb uuid; v_pipe_imp uuid; v_first_stage uuid;
  v_implantador uuid; v_pipe_tem_gatilho boolean; v_first_inicia boolean; v_sla_ini timestamptz;
  v_dept uuid; v_auto boolean := false;
  v_strategy text; v_dept_nome text; v_motivo text; v_carga int; v_nome text;
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;

  SELECT p.id INTO v_pipe_onb FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='onboarding' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  SELECT p.id INTO v_pipe_imp FROM public.onboarding_pipelines p
   WHERE p.tenant_id=p_tenant_id AND p.fase='implantacao' AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id=p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position LIMIT 1;

  SELECT id INTO v_first_stage FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe_onb AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  IF v_first_stage IS NULL THEN
    RAISE EXCEPTION 'Nenhum pipeline de onboarding com etapas configurado para este tenant/produto. Configure as etapas antes de criar a jornada.';
  END IF;

  -- (SLA) etapa-gatilho: se o pipeline tem uma, o SLA só começa ao entrar nela.
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x WHERE x.pipeline_id = v_pipe_onb AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;
  SELECT COALESCE(inicia_sla, false) INTO v_first_inicia
    FROM public.onboarding_stages WHERE id = v_first_stage;

  IF COALESCE(v_pipe_tem_gatilho, false) THEN
    v_sla_ini := CASE WHEN COALESCE(v_first_inicia, false) THEN now() ELSE NULL END;
  ELSE
    v_sla_ini := CASE WHEN p_data_inicio_planejado IS NOT NULL AND p_data_inicio_planejado <= now()
                      THEN now() ELSE NULL END;
  END IF;

  -- (DISTRIBUIÇÃO) setor da fase: define o pool do rodízio e vai para o ticket.
  SELECT p.department_id INTO v_dept FROM public.onboarding_pipelines p WHERE p.id = v_pipe_onb;
  v_dept := COALESCE(p_department_id, v_dept);

  -- Sem setor configurado, mantém auth.uid(): senão todo tenant que ainda não
  -- configurou passaria a criar jornada órfã — regressão.
  IF p_implantador_user_id IS NOT NULL THEN
    v_implantador := p_implantador_user_id;
  ELSIF v_dept IS NOT NULL THEN
    v_implantador := public.fn_onboarding_pick_assignee(p_tenant_id, v_dept);
    v_auto := v_implantador IS NOT NULL;
  ELSE
    v_implantador := auth.uid();
  END IF;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao, unidade_base_id, department_id)
  VALUES (p_tenant_id, p_cliente_id, p_assunto, p_descricao, 'onboarding', 'whatsapp', 'onboarding_manual', p_unidade_base_id, v_dept)
  RETURNING id INTO v_ticket_id;

  INSERT INTO public.onboarding_journeys (
    tenant_id, ticket_id, cliente_id, produto_id, demand_type_id,
    pipeline_onboarding_id, pipeline_implantacao_id, current_stage_id,
    fase_atual, situacao, data_inicio_planejado, go_live_previsto, sla_iniciado_em
  ) VALUES (
    p_tenant_id, v_ticket_id, p_cliente_id, p_produto_id, p_demand_type_id,
    v_pipe_onb, v_pipe_imp, v_first_stage, 'onboarding', 'nao_iniciado',
    p_data_inicio_planejado, p_go_live_previsto, v_sla_ini
  ) RETURNING id INTO v_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (p_tenant_id, v_journey_id, v_first_stage);

  IF v_implantador IS NOT NULL THEN
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (p_tenant_id, v_ticket_id, v_implantador, public.fn_onboarding_role_id(p_tenant_id, 'implantador')) ON CONFLICT DO NOTHING;

    UPDATE public.onboarding_journeys
       SET responsavel_user_id = v_implantador
     WHERE id = v_journey_id;

    IF v_auto THEN
      SELECT COALESCE(r.strategy, 'menor_carga'), d.name
        INTO v_strategy, v_dept_nome
        FROM public.support_departments d
        LEFT JOIN public.onboarding_assignment_rules r
               ON r.tenant_id = p_tenant_id AND r.department_id = d.id AND r.is_active
       WHERE d.id = v_dept;

      v_motivo := 'Distribuição automática · ' || COALESCE(v_strategy, 'menor_carga')
                  || ' · setor ' || COALESCE(v_dept_nome, '—');
    END IF;

    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de, motivo)
    VALUES (p_tenant_id, v_journey_id, v_implantador, now(), v_motivo);

    IF v_auto THEN
      SELECT count(*) INTO v_carga
        FROM public.onboarding_journeys j
       WHERE j.tenant_id = p_tenant_id
         AND j.responsavel_user_id = v_implantador
         AND j.situacao NOT IN ('concluido', 'cancelado')
         AND j.id <> v_journey_id;

      SELECT f.nome INTO v_nome
        FROM public.profiles p LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
       WHERE p.user_id = v_implantador AND p.tenant_id = p_tenant_id;

      INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
      VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_responsavel_auto',
              'Responsável definido por distribuição automática: ' || COALESCE(v_nome, 'usuário')
              || ' · ' || COALESCE(v_strategy, 'menor_carga')
              || ' · carga antes desta jornada: ' || v_carga,
              v_implantador::text);
    END IF;
  END IF;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_criado', 'Jornada de onboarding criada');

  RETURN v_journey_id;
END $function$;
