-- O ticket não troca de trilho ao virar de fase.
--
-- Bug de 12/08/2026 (TK-2026-3092, Digi Office): jornada nasceu no "Onboarding Gula" e foi
-- parar na "Implantação PDV". create_onboarding_journey resolvia os DOIS pipelines na criação
-- e congelava em pipeline_implantacao_id; naquele instante a "Implantação Gula" ainda não
-- tinha etapa (foram criadas 51 min depois) e o guard `EXISTS (stages ativas)` a descartou.
-- advance_onboarding_to_implantacao só lia a coluna congelada — nunca reavaliava.
--
-- Mesma família, segundo defeito: advance_onboarding_phase escolhia o pipeline da fase
-- destino SEM filtrar produto no WHERE. Em `ORDER BY (produto_id = v_produto) DESC NULLS
-- LAST` o `false` (pipeline dedicado de OUTRO produto) vem antes do NULL (genérico) — é o
-- erro já corrigido em 07/08 nas fn_onb_trilho_*, que ficou para trás aqui.
--
-- A regra de escolha estava reimplementada em 3 lugares com 3 variações. Passa a ter dona:
-- fn_onb_pipeline_do_trilho. Teste: scripts/sql-tests/42_pipeline_do_trilho_na_virada.sql

-- ---------------------------------------------------------------------------- regra única
CREATE OR REPLACE FUNCTION public.fn_onb_pipeline_do_trilho(
  p_tenant_id uuid, p_produto_id bigint, p_phase_id uuid
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- O pipeline do produto ganha do genérico; pipeline de OUTRO produto nunca entra (é o
  -- filtro no WHERE que garante isso — o ORDER BY sozinho deixa o `false` passar na frente
  -- do NULL). Só considera quem tem etapa ativa: quadro sem coluna esconde o ticket.
  SELECT p.id FROM public.onboarding_pipelines p
   WHERE p.tenant_id = p_tenant_id
     AND p.phase_id = p_phase_id
     AND p.ativo
     AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
   LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_pipeline_do_trilho(uuid, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_onb_pipeline_do_trilho(uuid, bigint, uuid) TO service_role;

-- ------------------------------------------------------------------------------- criação
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
  v_phase_onb uuid; v_phase_imp uuid;
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;

  -- Pipelines do trilho, pela regra única. O de implantação gravado aqui é só o palpite do
  -- dia da criação: quem manda na virada é advance_onboarding_to_implantacao, que resolve
  -- de novo (a configuração pode mudar entre criar a jornada e concluir o onboarding).
  SELECT ph.id INTO v_phase_onb FROM public.onboarding_phases ph
   WHERE ph.tenant_id = p_tenant_id AND ph.slug = 'onboarding' LIMIT 1;
  SELECT ph.id INTO v_phase_imp FROM public.onboarding_phases ph
   WHERE ph.tenant_id = p_tenant_id AND ph.slug = 'implantacao' LIMIT 1;

  v_pipe_onb := public.fn_onb_pipeline_do_trilho(p_tenant_id, p_produto_id, v_phase_onb);
  v_pipe_imp := public.fn_onb_pipeline_do_trilho(p_tenant_id, p_produto_id, v_phase_imp);

  -- primeira etapa do pipeline escolhido
  SELECT id INTO v_first_stage FROM public.onboarding_stages
   WHERE pipeline_id=v_pipe_onb AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  -- guard: sem etapa configurada em lugar nenhum -> erro claro (evita jornada orfa invisivel)
  IF v_first_stage IS NULL THEN
    RAISE EXCEPTION 'Nenhum pipeline de onboarding com etapas configurado para este tenant/produto. Configure as etapas antes de criar a jornada.';
  END IF;

  -- etapa gatilho de SLA no pipeline escolhido (20260726120000)
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x WHERE x.pipeline_id = v_pipe_onb AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;
  SELECT COALESCE(inicia_sla, false) INTO v_first_inicia
    FROM public.onboarding_stages WHERE id = v_first_stage;

  IF COALESCE(v_pipe_tem_gatilho, false) THEN
    -- com gatilho configurado: so parte se a jornada ja nasce na etapa que dispara
    v_sla_ini := CASE WHEN COALESCE(v_first_inicia, false) THEN now() ELSE NULL END;
  ELSE
    -- sem gatilho: comportamento historico
    v_sla_ini := CASE WHEN p_data_inicio_planejado IS NOT NULL AND p_data_inicio_planejado <= now()
                      THEN now() ELSE NULL END;
  END IF;

  -- setor da fase: define o pool da distribuicao e vai para o ticket (20260726100000)
  SELECT p.department_id INTO v_dept FROM public.onboarding_pipelines p WHERE p.id = v_pipe_onb;
  v_dept := COALESCE(p_department_id, v_dept);

  IF p_implantador_user_id IS NOT NULL THEN
    v_implantador := p_implantador_user_id;
  ELSIF v_dept IS NOT NULL THEN
    v_implantador := public.fn_onboarding_pick_assignee(p_tenant_id, v_dept);
    v_auto := v_implantador IS NOT NULL;
  ELSE
    -- sem setor configurado, mantem o comportamento historico
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

-- --------------------------------------------------------- virada onboarding → implantação
CREATE OR REPLACE FUNCTION public.advance_onboarding_to_implantacao(p_journey_id uuid, p_force boolean DEFAULT false, p_sem_treino_ok boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_parent uuid; v_fase public.onb_fase_atual; v_pipe_imp uuid;
  v_cur uuid; v_is_final boolean; v_first_imp uuid; v_open_hist uuid; v_now timestamptz := now();
  v_novo_resp uuid; v_resp_atual uuid;
  v_hist_stage uuid; v_dept uuid;
  v_first_inicia boolean; v_pipe_tem_gatilho boolean;
  v_first_encerra boolean; v_enc_em timestamptz; v_enc_stage uuid;
  v_ordem_alvo int; v_ordem_enc int;
  v_reabre boolean := false; v_encerra_agora boolean := false;
  v_tem_treino boolean;
  v_produto bigint; v_phase_imp uuid; v_pipe_trilho uuid; v_pipe_antigo uuid;
BEGIN
  SELECT tenant_id, ticket_id, fase_atual, pipeline_implantacao_id, current_stage_id, produto_id
    INTO v_tenant, v_parent, v_fase, v_pipe_imp, v_cur, v_produto
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_fase <> 'onboarding' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_em_onboarding');
  END IF;

  -- O trilho manda, e é resolvido AGORA. O pipeline_implantacao_id gravado na criação era
  -- o palpite daquele dia: em 12/08/2026 o pipeline do produto ainda estava sem etapa e o
  -- ticket do Gula caiu na Implantação PDV. A coluna passa a registrar o que foi usado.
  SELECT ph.id INTO v_phase_imp FROM public.onboarding_phases ph
   WHERE ph.tenant_id = v_tenant AND ph.slug = 'implantacao' LIMIT 1;
  v_pipe_trilho := public.fn_onb_pipeline_do_trilho(v_tenant, v_produto, v_phase_imp);
  v_pipe_antigo := v_pipe_imp;
  v_pipe_imp := COALESCE(v_pipe_trilho, v_pipe_imp);

  IF v_pipe_imp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_pipeline_implantacao');
  END IF;

  SELECT is_final INTO v_is_final FROM public.onboarding_stages WHERE id = v_cur;
  IF NOT p_force AND COALESCE(v_is_final, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_etapa_final');
  END IF;

  -- DEM-0269: entrar na Implantação sem treino tem que ser escolha, não default.
  -- Quem chama decide o que fazer com a recusa (diálogo com as duas saídas).
  v_tem_treino := public.fn_onb_tem_treino_vivo(p_journey_id);
  IF NOT p_sem_treino_ok AND NOT v_tem_treino THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_treino');
  END IF;

  SELECT id INTO v_first_imp FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_imp AND ativo ORDER BY is_initial DESC, position LIMIT 1;
  IF v_first_imp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'implantacao_sem_etapa');
  END IF;

  -- fecha a etapa aberta atual (onboarding), medindo em horário útil como
  -- move_onboarding_stage já faz. Sem isto a Régua fica com buraco.
  SELECT id, stage_id INTO v_open_hist, v_hist_stage
    FROM public.onboarding_stage_history
   WHERE journey_id = p_journey_id AND saiu_em IS NULL ORDER BY entrou_em DESC LIMIT 1;
  IF v_open_hist IS NOT NULL THEN
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_parent
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open_hist;
  END IF;

  SELECT COALESCE(inicia_sla,false), COALESCE(encerra_sla,false)
    INTO v_first_inicia, v_first_encerra
    FROM public.onboarding_stages WHERE id = v_first_imp;
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = v_pipe_imp AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;

  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  v_ordem_alvo := public.fn_onb_stage_ordem(v_first_imp);
  v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
                       ELSE public.fn_onb_stage_ordem(v_enc_stage) END;
  v_encerra_agora := COALESCE(v_first_encerra,false) AND v_enc_em IS NULL;
  v_reabre := v_enc_em IS NOT NULL AND NOT COALESCE(v_first_encerra,false)
              AND v_ordem_enc IS NOT NULL AND v_ordem_alvo IS NOT NULL
              AND v_ordem_alvo < v_ordem_enc;

  UPDATE public.onboarding_journeys
     SET fase_atual = 'implantacao', current_stage_id = v_first_imp,
         pipeline_implantacao_id = v_pipe_imp,
         situacao = CASE WHEN situacao = 'nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = CASE
           WHEN COALESCE(v_pipe_tem_gatilho,false) AND COALESCE(v_first_inicia,false)
             THEN COALESCE(sla_iniciado_em, v_now)
           WHEN COALESCE(v_pipe_tem_gatilho,false) THEN sla_iniciado_em
           ELSE COALESCE(sla_iniciado_em, v_now)
         END,
         sla_encerrado_em = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_em, v_now)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_em
         END,
         sla_encerrado_stage_id = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_stage_id, v_first_imp)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_stage_id
         END,
         onboarding_concluido_em = COALESCE(onboarding_concluido_em, v_now),
         implantacao_iniciada_em = COALESCE(implantacao_iniciada_em, v_now)
   WHERE id = p_journey_id;

  PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, 'onboarding');

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, v_first_imp);

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_fase_implantacao',
          CASE WHEN v_tem_treino
               THEN 'Onboarding concluído · Implantação iniciada'
               ELSE 'Onboarding concluído · Implantação iniciada (sem treino agendado)' END);

  -- Quando o palpite da criação não era o trilho, isso fica no histórico do ticket: sem
  -- este evento a mudança de quadro parece que aconteceu sozinha.
  IF v_pipe_antigo IS NOT NULL AND v_pipe_antigo IS DISTINCT FROM v_pipe_imp THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, old_value, new_value)
    VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_pipeline_trilho',
            'Implantação alinhada ao trilho: '
            || COALESCE((SELECT nome FROM public.onboarding_pipelines WHERE id = v_pipe_antigo), '—')
            || ' → '
            || COALESCE((SELECT nome FROM public.onboarding_pipelines WHERE id = v_pipe_imp), '—'),
            v_pipe_antigo::text, v_pipe_imp::text);
  END IF;

  IF v_encerra_agora THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_sla_encerrado',
            'Contagem de SLA encerrada no início da Implantação');
  ELSIF v_reabre THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_parent, auth.uid(), 'onboarding_sla_reaberto',
            'Contagem de SLA reaberta pelo avanço de fase');
  END IF;

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

-- ------------------------------------------------------------- virada para fase genérica
CREATE OR REPLACE FUNCTION public.advance_onboarding_phase(p_journey_id uuid, p_target_phase_id uuid DEFAULT NULL::uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid; v_ticket uuid; v_produto bigint;
  v_cur_phase uuid; v_cur_slug text; v_cur_stage uuid; v_situacao public.onb_situacao;
  v_tgt_phase uuid; v_tgt_slug text; v_tgt_nome text;
  v_pipe uuid; v_first uuid; v_is_final boolean;
  v_open_hist uuid; v_hist_stage uuid; v_dept uuid;
  v_now timestamptz := now();
  -- 01/08
  v_first_inicia boolean; v_pipe_tem_gatilho boolean;
  v_first_encerra boolean; v_enc_em timestamptz; v_enc_stage uuid;
  v_ordem_alvo int; v_ordem_enc int;
  v_reabre boolean := false; v_encerra_agora boolean := false;
BEGIN
  SELECT j.tenant_id, j.ticket_id, j.produto_id, j.current_phase_id, j.current_stage_id, j.situacao
    INTO v_tenant, v_ticket, v_produto, v_cur_phase, v_cur_stage, v_situacao
    FROM public.onboarding_journeys j WHERE j.id = p_journey_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  IF v_situacao IN ('concluido'::public.onb_situacao, 'cancelado'::public.onb_situacao) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_terminal');
  END IF;
  IF v_cur_phase IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'jornada_sem_fase');
  END IF;

  v_tgt_phase := COALESCE(p_target_phase_id, public.fn_onboarding_next_phase(p_journey_id));
  IF v_tgt_phase IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sem_proxima_fase');
  END IF;
  IF v_tgt_phase = v_cur_phase THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ja_nesta_fase');
  END IF;

  SELECT slug INTO v_cur_slug FROM public.onboarding_phases WHERE id = v_cur_phase;
  SELECT slug, nome INTO v_tgt_slug, v_tgt_nome FROM public.onboarding_phases WHERE id = v_tgt_phase;

  -- Caminho histórico: quem manda continua sendo a RPC específica.
  IF v_cur_slug = 'onboarding' AND v_tgt_slug = 'implantacao' THEN
    RETURN public.advance_onboarding_to_implantacao(p_journey_id, p_force);
  END IF;

  -- Só avança da etapa final, salvo force.
  SELECT is_final INTO v_is_final FROM public.onboarding_stages WHERE id = v_cur_stage;
  IF NOT p_force AND COALESCE(v_is_final, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nao_etapa_final');
  END IF;

  -- Pipeline da fase destino pela regra única. A query antiga não filtrava produto no
  -- WHERE, e o pipeline dedicado a OUTRO produto (`false`) passava na frente do genérico
  -- (`NULL`) — mesmo erro corrigido em 07/08 nas fn_onb_trilho_*.
  v_pipe := public.fn_onb_pipeline_do_trilho(v_tenant, v_produto, v_tgt_phase);

  IF v_pipe IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fase_sem_pipeline', 'fase', v_tgt_nome);
  END IF;

  SELECT id INTO v_first FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND ativo ORDER BY is_initial DESC, position LIMIT 1;
  IF v_first IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'fase_sem_etapa', 'fase', v_tgt_nome);
  END IF;

  -- Fecha a etapa aberta, medindo em horário útil como move_onboarding_stage faz.
  SELECT h.id, h.stage_id INTO v_open_hist, v_hist_stage
    FROM public.onboarding_stage_history h
   WHERE h.journey_id = p_journey_id AND h.saiu_em IS NULL
   ORDER BY h.entrou_em DESC LIMIT 1;

  IF v_open_hist IS NOT NULL THEN
    SELECT COALESCE(p.department_id, t.department_id) INTO v_dept
      FROM public.onboarding_stages s
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.support_tickets t ON t.id = v_ticket
     WHERE s.id = v_hist_stage;

    UPDATE public.onboarding_stage_history
       SET saiu_em = v_now,
           duracao_minutos = GREATEST(0, EXTRACT(EPOCH FROM (v_now - entrou_em))/60)::int,
           duracao_util_minutos = public.fn_onb_util_min(entrou_em, v_now, v_tenant, v_dept)
     WHERE id = v_open_hist;
  END IF;

  -- gatilho e encerramento resolvidos contra o pipeline/etapa de DESTINO
  SELECT COALESCE(inicia_sla,false), COALESCE(encerra_sla,false)
    INTO v_first_inicia, v_first_encerra
    FROM public.onboarding_stages WHERE id = v_first;
  SELECT EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = v_pipe AND x.inicia_sla)
    INTO v_pipe_tem_gatilho;

  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc_em, v_enc_stage
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  v_ordem_alvo := public.fn_onb_stage_ordem(v_first);
  v_ordem_enc  := CASE WHEN v_enc_stage IS NULL THEN NULL
                       ELSE public.fn_onb_stage_ordem(v_enc_stage) END;
  v_encerra_agora := COALESCE(v_first_encerra,false) AND v_enc_em IS NULL;
  v_reabre := v_enc_em IS NOT NULL AND NOT COALESCE(v_first_encerra,false)
              AND v_ordem_enc IS NOT NULL AND v_ordem_alvo IS NOT NULL
              AND v_ordem_alvo < v_ordem_enc;

  -- Os marcos legados continuam sendo mantidos enquanto vw_onboarding_journeys existir.
  UPDATE public.onboarding_journeys
     SET current_phase_id = v_tgt_phase,
         current_stage_id = v_first,
         situacao = CASE WHEN situacao = 'nao_iniciado' THEN 'em_andamento'::public.onb_situacao ELSE situacao END,
         sla_iniciado_em = CASE
           WHEN COALESCE(v_pipe_tem_gatilho,false) AND COALESCE(v_first_inicia,false)
             THEN COALESCE(sla_iniciado_em, v_now)
           WHEN COALESCE(v_pipe_tem_gatilho,false) THEN sla_iniciado_em
           ELSE COALESCE(sla_iniciado_em, v_now)
         END,
         sla_encerrado_em = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_em, v_now)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_em
         END,
         sla_encerrado_stage_id = CASE
           WHEN COALESCE(v_first_encerra,false) THEN COALESCE(sla_encerrado_stage_id, v_first)
           WHEN v_reabre                        THEN NULL
           ELSE sla_encerrado_stage_id
         END,
         onboarding_concluido_em  = CASE WHEN v_cur_slug = 'onboarding'  THEN COALESCE(onboarding_concluido_em,  v_now) ELSE onboarding_concluido_em  END,
         implantacao_concluida_em = CASE WHEN v_cur_slug = 'implantacao' THEN COALESCE(implantacao_concluida_em, v_now) ELSE implantacao_concluida_em END,
         implantacao_iniciada_em  = CASE WHEN v_tgt_slug = 'implantacao' THEN COALESCE(implantacao_iniciada_em,  v_now) ELSE implantacao_iniciada_em  END
   WHERE id = p_journey_id;

  -- A linha da fase (abrir a nova, fechar a anterior) é responsabilidade do trigger
  -- trg_open_onb_phase_row; congela o SLA da fase que terminou quando ela tem enum.
  IF v_cur_slug IN ('onboarding','implantacao') THEN
    PERFORM public.fn_snapshot_onboarding_phase(p_journey_id, v_cur_slug::public.onb_fase);
  END IF;

  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id)
  VALUES (v_tenant, p_journey_id, v_first);

  INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
  VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_fase_avancou',
          'Jornada avançou para ' || COALESCE(v_tgt_nome, 'próxima fase'));

  IF v_encerra_agora THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_encerrado',
            'Contagem de SLA encerrada ao entrar em ' || COALESCE(v_tgt_nome, 'próxima fase'));
  ELSIF v_reabre THEN
    INSERT INTO public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content)
    VALUES (v_tenant, v_ticket, auth.uid(), 'onboarding_sla_reaberto',
            'Contagem de SLA reaberta pelo avanço para ' || COALESCE(v_tgt_nome, 'próxima fase'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'stage_id', v_first, 'phase_id', v_tgt_phase, 'fase', v_tgt_nome);
END $function$;
