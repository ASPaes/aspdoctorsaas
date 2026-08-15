-- Nova jornada nasce no pipeline ESCOLHIDO no quadro, não sempre no Onboarding.
--
-- Até aqui `create_onboarding_journey` gravava `fase_atual = 'onboarding'` literal e
-- resolvia o pipeline pelo trilho do produto. Quem estava com "Implantação › Implantação
-- Gula" aberto e clicava em "+ Nova jornada" via o ticket nascer no Onboarding, e não
-- existia caminho nenhum para abrir um atendimento que já começa na Implantação —
-- cliente que não passa pelo processo de onboarding.
--
-- Agora a RPC aceita `p_pipeline_id`. O pipeline carrega a fase (phase_id), então não há
-- como pedir fase e pipeline incoerentes. Sem o parâmetro, o comportamento é o de sempre.
--
-- Decisão do Alexandre (14/08/2026): a escolha explícita da tela GANHA do trilho do
-- produto. O trilho continua valendo quando ninguém escolheu (webhook de intake, testes).
--
-- O go-live previsto vinha do trilho INTEIRO (onboarding + implantação). Numa jornada que
-- já nasce na Implantação isso inflaria o prazo com etapas que ela nunca vai percorrer —
-- por isso `fn_onb_trilho_sla_min` e `fn_journey_go_live` ganham um recorte de fase.
--
-- DROP + CREATE (e não CREATE OR REPLACE) porque parâmetro novo com DEFAULT cria uma
-- SOBRECARGA: as chamadas antigas ficariam ambíguas ("function is not unique").

-- ============================================================================
-- 1) fn_onb_trilho_sla_min: soma o trilho a partir de uma fase
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_onb_trilho_sla_min(uuid, bigint);

CREATE OR REPLACE FUNCTION public.fn_onb_trilho_sla_min(
  p_tenant_id uuid,
  p_produto_id bigint DEFAULT NULL::bigint,
  p_from_phase_id uuid DEFAULT NULL::uuid
) RETURNS integer
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_total int := 0;
  v_from_pos int;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  -- Recorte: só as fases desta em diante. Fase inexistente no tenant é ignorada (soma o
  -- trilho inteiro) em vez de devolver zero, que a tela leria como "sem SLA configurado".
  IF p_from_phase_id IS NOT NULL THEN
    SELECT ph.position INTO v_from_pos
      FROM public.onboarding_phases ph
     WHERE ph.id = p_from_phase_id AND ph.tenant_id = p_tenant_id;
  END IF;

  WITH trilho AS (
    SELECT ph.position AS fpos,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = p_tenant_id AND p.phase_id = ph.id AND p.ativo
               AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s
                            WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
             LIMIT 1) AS pipeline_id
      FROM public.onboarding_phases ph
     WHERE ph.tenant_id = p_tenant_id AND ph.ativo
       AND (v_from_pos IS NULL OR ph.position >= v_from_pos)
  ), etapas AS (
    SELECT s.sla_minutos,
           COALESCE(s.inicia_sla,false)  AS inicia_sla,
           COALESCE(s.encerra_sla,false) AS encerra_sla,
           COALESCE(s.pausa_sla,false)   AS pausa_sla,
           row_number() OVER (ORDER BY t.fpos, s.position) AS ord
      FROM trilho t
      JOIN public.onboarding_stages s ON s.pipeline_id = t.pipeline_id AND s.ativo
  ), janela AS (
    SELECT COALESCE(min(ord) FILTER (WHERE inicia_sla),  min(ord)) AS ini,
           COALESCE(min(ord) FILTER (WHERE encerra_sla), max(ord)) AS fim
      FROM etapas
  )
  SELECT COALESCE(sum(e.sla_minutos), 0) INTO v_total
    FROM etapas e CROSS JOIN janela j
   WHERE e.ord >= j.ini AND e.ord <= j.fim
     AND NOT e.pausa_sla;

  RETURN COALESCE(v_total, 0);
END $$;

ALTER FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint, uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint, uuid) IS
  'Minutos úteis configurados no trilho do produto, da etapa que inicia o SLA até a que encerra. Com p_from_phase_id, conta só desta fase em diante.';

REVOKE ALL ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint, uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_onb_trilho_sla_min(uuid, bigint, uuid) TO service_role;

-- ============================================================================
-- 2) fn_journey_go_live: repassa o recorte de fase
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_journey_go_live(uuid, timestamptz, bigint, uuid);

CREATE OR REPLACE FUNCTION public.fn_journey_go_live(
  p_tenant_id uuid,
  p_start timestamp with time zone,
  p_produto_id bigint,
  p_department_id uuid DEFAULT NULL::uuid,
  p_from_phase_id uuid DEFAULT NULL::uuid
) RETURNS date
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_min integer;
  v_days integer;
  v_tz text;
  v_start_date date;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);

  v_min := public.fn_onb_trilho_sla_min(p_tenant_id, p_produto_id, p_from_phase_id);
  IF v_min IS NULL OR v_min <= 0 THEN
    RETURN NULL;
  END IF;

  -- base_dia_util_8h: 1 dia util = 480 minutos
  v_days := CEIL(v_min::numeric / 480.0)::int;

  SELECT COALESCE(business_hours_timezone, 'America/Sao_Paulo') INTO v_tz
  FROM public.configuracoes WHERE tenant_id = p_tenant_id;
  v_tz := COALESCE(v_tz, 'America/Sao_Paulo');

  v_start_date := (COALESCE(p_start, now()) AT TIME ZONE v_tz)::date;

  RETURN public.fn_add_business_days(v_start_date, v_days, p_tenant_id, p_department_id);
END $$;

ALTER FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid, uuid) TO authenticated;
GRANT ALL ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, bigint, uuid, uuid) TO service_role;

-- ============================================================================
-- 3) create_onboarding_journey: aceita o pipeline escolhido no quadro
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_onboarding_journey(
  uuid, uuid, text, bigint, timestamptz, date, uuid, text, uuid, bigint, uuid);

CREATE OR REPLACE FUNCTION public.create_onboarding_journey(
  p_tenant_id uuid,
  p_cliente_id uuid,
  p_assunto text,
  p_produto_id bigint DEFAULT NULL::bigint,
  p_data_inicio_planejado timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_go_live_previsto date DEFAULT NULL::date,
  p_implantador_user_id uuid DEFAULT NULL::uuid,
  p_descricao text DEFAULT NULL::text,
  p_demand_type_id uuid DEFAULT NULL::uuid,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_department_id uuid DEFAULT NULL::uuid,
  p_pipeline_id uuid DEFAULT NULL::uuid
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;

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
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (p_tenant_id, v_ticket_id, v_implantador, public.fn_onboarding_role_id(p_tenant_id, 'implantador')) ON CONFLICT DO NOTHING;

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
END $$;

ALTER FUNCTION public.create_onboarding_journey(
  uuid, uuid, text, bigint, timestamptz, date, uuid, text, uuid, bigint, uuid, uuid) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_onboarding_journey(
  uuid, uuid, text, bigint, timestamptz, date, uuid, text, uuid, bigint, uuid, uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_onboarding_journey(
  uuid, uuid, text, bigint, timestamptz, date, uuid, text, uuid, bigint, uuid, uuid) TO authenticated;
GRANT ALL ON FUNCTION public.create_onboarding_journey(
  uuid, uuid, text, bigint, timestamptz, date, uuid, text, uuid, bigint, uuid, uuid) TO service_role;
