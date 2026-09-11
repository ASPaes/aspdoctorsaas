-- DEM-0379, parte 2. Fecha o que a parte 1 (20260910090000) deixou em aberto.
--
-- Dois defeitos medidos em 11/09/2026:
--
-- 1. O mapa setor -> papel nunca foi preenchido. Com ele vazio o resolvedor devolve
--    NULL e a transferência cai no fallback, ou seja, no comportamento antigo. A
--    feature estava no ar e desligada.
--
-- 2. `create_onboarding_journey` não passa pela transferência: ela grava o
--    participante e o histórico direto, com o slug fixo 'implantador'. Como a
--    "Distribuição automática" acontece dentro dela, TODA jornada nova nascia
--    carimbada com esse papel, que na Digi Office se chama "Onboarding". Foi o que
--    levou as divergências de 88 (09/09) para 91 (11/09).
--
-- Sem backfill do passado: decisão do owner, mantida.

-- ------------------------------------------------------------------ 1. o mapa
-- Digi Office: papel "Onboarding" (slug implantador) -> setor Onboarding;
--              papel "Implantador" (slug especialista) -> setor Implantação.
-- Escrito por nome, não por id, e só onde ainda está vazio: rodar duas vezes não
-- desfaz ajuste que alguém tenha feito pela tela.
UPDATE public.onboarding_participant_roles r
   SET department_id = d.id
  FROM public.support_departments d
 WHERE r.tenant_id = d.tenant_id
   AND r.tenant_id = (SELECT id FROM public.tenants WHERE nome = 'Digi Office Sistemas')
   AND d.is_active
   AND r.department_id IS NULL
   AND ( (r.slug = 'implantador'  AND d.name = 'Onboarding')
      OR (r.slug = 'especialista' AND d.name = 'Implantação') );

-- --------------------------------------------------- 2. papel na criação da jornada
-- Base: definição de produção lida em 11/09/2026 (md5 48c00040209cc800493180e90766d478),
-- que é bem diferente da que está versionada no repo. Muda uma linha: o papel do
-- responsável inicial passa pelo resolvedor de setor, com o slug fixo como fallback.
CREATE OR REPLACE FUNCTION public.create_onboarding_journey(p_tenant_id uuid, p_cliente_id uuid, p_assunto text, p_produto_id bigint DEFAULT NULL::bigint, p_data_inicio_planejado timestamp with time zone DEFAULT NULL::timestamp with time zone, p_go_live_previsto date DEFAULT NULL::date, p_implantador_user_id uuid DEFAULT NULL::uuid, p_descricao text DEFAULT NULL::text, p_demand_type_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_department_id uuid DEFAULT NULL::uuid, p_pipeline_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ticket_id uuid; v_journey_id uuid; v_pipe_onb uuid; v_pipe_imp uuid; v_first_stage uuid;
  v_implantador uuid; v_pipe_tem_gatilho boolean; v_first_inicia boolean; v_sla_ini timestamptz;
  v_dept uuid; v_auto boolean := false;
  v_pipe_nome text; v_tem_distribuicao boolean;
  v_strategy text; v_dept_nome text; v_motivo text; v_carga int; v_nome text;
  v_phase_onb uuid; v_phase_imp uuid;
  v_pipe_alvo uuid; v_phase_alvo uuid; v_slug_alvo text; v_phase_nome text;
  v_direto boolean := false; v_now timestamptz := now();
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id)
     AND current_setting('role', true) IS DISTINCT FROM 'service_role'
  THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;

  SELECT ph.id INTO v_phase_onb FROM public.onboarding_phases ph
   WHERE ph.tenant_id = p_tenant_id AND ph.slug = 'onboarding' LIMIT 1;
  SELECT ph.id INTO v_phase_imp FROM public.onboarding_phases ph
   WHERE ph.tenant_id = p_tenant_id AND ph.slug = 'implantacao' LIMIT 1;

  -- Fase e pipeline de nascimento. Com pipeline escolhido na tela, é ele quem manda: a
  -- fase vem do próprio pipeline (phase_id), então pedido incoerente não existe.
  IF p_pipeline_id IS NOT NULL THEN
    SELECT p.id, ph.id, ph.slug, ph.nome
      INTO v_pipe_alvo, v_phase_alvo, v_slug_alvo, v_phase_nome
      FROM public.onboarding_pipelines p
      JOIN public.onboarding_phases ph ON ph.id = p.phase_id
     WHERE p.id = p_pipeline_id AND p.tenant_id = p_tenant_id AND p.ativo;

    IF v_pipe_alvo IS NULL THEN
      RAISE EXCEPTION 'O quadro escolhido não existe neste tenant ou está inativo.';
    END IF;

    -- onboarding_journeys.fase_atual é enum de duas fases. Acompanhamento tem quadro e
    -- fluxo próprios: recusar aqui é melhor que gravar a jornada na fase errada.
    IF v_slug_alvo NOT IN ('onboarding', 'implantacao') THEN
      RAISE EXCEPTION 'Jornada só pode ser aberta em Onboarding ou Implantação (recebido: %).', v_phase_nome;
    END IF;
  ELSE
    v_phase_alvo := v_phase_onb;
    v_slug_alvo  := 'onboarding';
    v_pipe_alvo  := public.fn_onb_pipeline_do_trilho(p_tenant_id, p_produto_id, v_phase_onb);
    SELECT ph.nome INTO v_phase_nome FROM public.onboarding_phases ph WHERE ph.id = v_phase_alvo;
  END IF;

  v_direto := (v_slug_alvo = 'implantacao');

  -- O pipeline da OUTRA fase é só o palpite do dia da criação; quem manda na virada é
  -- advance_onboarding_to_implantacao, que resolve de novo. Nascendo na Implantação, não
  -- existe pipeline de onboarding: a jornada nunca passou por lá.
  IF v_direto THEN
    v_pipe_onb := NULL;
    v_pipe_imp := v_pipe_alvo;
  ELSE
    v_pipe_onb := v_pipe_alvo;
    v_pipe_imp := public.fn_onb_pipeline_do_trilho(p_tenant_id, p_produto_id, v_phase_imp);
  END IF;

  -- primeira etapa do pipeline escolhido
  SELECT id INTO v_first_stage FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_alvo AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  -- guard: sem etapa configurada em lugar nenhum -> erro claro (evita jornada orfa invisivel)
  IF v_first_stage IS NULL THEN
    RAISE EXCEPTION 'Nenhum quadro de % com etapas configurado para este tenant/produto. Configure as etapas antes de criar a jornada.',
      COALESCE(v_phase_nome, 'onboarding');
  END IF;

  -- etapa gatilho de SLA no pipeline escolhido (20260726120000)
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x WHERE x.pipeline_id = v_pipe_alvo AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;
  SELECT COALESCE(inicia_sla, false) INTO v_first_inicia
    FROM public.onboarding_stages WHERE id = v_first_stage;

  IF COALESCE(v_pipe_tem_gatilho, false) THEN
    -- com gatilho configurado: so parte se a jornada ja nasce na etapa que dispara
    v_sla_ini := CASE WHEN COALESCE(v_first_inicia, false) THEN v_now ELSE NULL END;
  ELSE
    -- sem gatilho: comportamento historico
    v_sla_ini := CASE WHEN p_data_inicio_planejado IS NOT NULL AND p_data_inicio_planejado <= v_now
                      THEN v_now ELSE NULL END;
  END IF;

  -- setor da fase: define o pool da distribuicao e vai para o ticket (20260726100000)
  SELECT p.department_id INTO v_dept FROM public.onboarding_pipelines p WHERE p.id = v_pipe_alvo;
  v_dept := COALESCE(p_department_id, v_dept);

  SELECT EXISTS (
           SELECT 1 FROM public.onboarding_assignment_rules r
            WHERE r.tenant_id = p_tenant_id AND r.pipeline_id = v_pipe_alvo AND r.is_active
              AND array_length(COALESCE(r.included_agents, '{}'), 1) IS NOT NULL
         ) INTO v_tem_distribuicao;

  IF p_implantador_user_id IS NOT NULL THEN
    v_implantador := p_implantador_user_id;
  ELSIF v_tem_distribuicao OR v_dept IS NOT NULL THEN
    v_implantador := public.fn_onboarding_pick_assignee(p_tenant_id, v_pipe_alvo);
    v_auto := v_implantador IS NOT NULL;
  ELSE
    -- sem setor configurado, mantem o comportamento historico
    v_implantador := auth.uid();
  END IF;

  INSERT INTO public.support_tickets (tenant_id, cliente_id, assunto, descricao, contexto, canal_origem, origem_criacao, unidade_base_id, department_id)
  VALUES (p_tenant_id, p_cliente_id, p_assunto, p_descricao, 'onboarding', 'whatsapp', 'onboarding_manual', p_unidade_base_id, v_dept)
  RETURNING id INTO v_ticket_id;

  -- fase_atual manda no INSERT: trg_sync_onb_journey_phase deriva current_phase_id dele, e
  -- trg_open_onb_phase_row abre a linha de onboarding_phase_metrics só desta fase — a
  -- jornada direta não ganha passagem falsa pelo Onboarding.
  --
  -- Nascendo na Implantação, onboarding_concluido_em/implantacao_iniciada_em recebem agora:
  -- é o que a vw_onboarding_journeys usa como fim do onboarding. Deixar NULL faria a view
  -- contar SLA de onboarding para sempre numa fase que nunca existiu.
  INSERT INTO public.onboarding_journeys (
    tenant_id, ticket_id, cliente_id, produto_id, demand_type_id,
    pipeline_onboarding_id, pipeline_implantacao_id, current_stage_id,
    fase_atual, situacao, data_inicio_planejado, go_live_previsto, sla_iniciado_em,
    onboarding_concluido_em, implantacao_iniciada_em
  ) VALUES (
    p_tenant_id, v_ticket_id, p_cliente_id, p_produto_id, p_demand_type_id,
    v_pipe_onb, v_pipe_imp, v_first_stage,
    v_slug_alvo::public.onb_fase_atual, 'nao_iniciado',
    p_data_inicio_planejado, p_go_live_previsto, v_sla_ini,
    CASE WHEN v_direto THEN v_now END,
    CASE WHEN v_direto THEN v_now END
  ) RETURNING id INTO v_journey_id;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (p_tenant_id, v_journey_id, v_first_stage);

  IF v_implantador IS NOT NULL THEN
    -- DEM-0379: o papel sai do setor de quem recebeu. Sem setor mapeado, é o papel
    -- padrão de sempre — que era o comportamento único até aqui.
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (p_tenant_id, v_ticket_id, v_implantador,
            COALESCE(public.fn_onboarding_role_id_do_setor(p_tenant_id, v_implantador),
                     public.fn_onboarding_role_id(p_tenant_id, 'implantador'))) ON CONFLICT DO NOTHING;

    UPDATE public.onboarding_journeys
       SET responsavel_user_id = v_implantador
     WHERE id = v_journey_id;

    IF v_auto THEN
      SELECT COALESCE(r.strategy, 'menor_carga'), p.nome
        INTO v_strategy, v_pipe_nome
        FROM public.onboarding_pipelines p
        LEFT JOIN public.onboarding_assignment_rules r
               ON r.tenant_id = p_tenant_id AND r.pipeline_id = p.id AND r.is_active
       WHERE p.id = v_pipe_alvo;

      v_motivo := 'Distribuição automática · ' || COALESCE(v_strategy, 'menor_carga')
                  || ' · pipeline ' || COALESCE(v_pipe_nome, '—');
    END IF;

    INSERT INTO public.onboarding_responsavel_history (tenant_id, journey_id, user_id, de, motivo)
    VALUES (p_tenant_id, v_journey_id, v_implantador, v_now, v_motivo);

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
              || ' · pipeline ' || COALESCE(v_pipe_nome, '—')
              || ' · carga antes desta jornada: ' || v_carga,
              v_implantador::text);
    END IF;
  END IF;

  SELECT p.nome INTO v_pipe_nome FROM public.onboarding_pipelines p WHERE p.id = v_pipe_alvo;

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (p_tenant_id, v_ticket_id, auth.uid(), 'onboarding_criado',
          CASE WHEN v_direto
               THEN 'Jornada criada direto na Implantação (sem passar pelo Onboarding) · ' || COALESCE(v_pipe_nome, '—')
               ELSE 'Jornada de onboarding criada · ' || COALESCE(v_pipe_nome, '—') END);

  RETURN v_journey_id;
END $function$;

-- ------------------------------------------------------------------ conferência
-- Feita por fora, com SELECT, depois que este script rodar. Um bloco de smoke com
-- RAISE EXCEPTION aqui dentro desfaria o UPDATE e o CREATE OR REPLACE acima: o SQL
-- Editor mantém a transação do script inteiro, e o rollback levaria tudo junto.
