-- Distribuição justa do responsável INICIAL da jornada de onboarding.
--
-- Problema que resolve: hoje `create_onboarding_journey` faz
-- COALESCE(p_implantador_user_id, auth.uid()) — quem cria a jornada vira o dono,
-- e via edge function (service_role, sem auth.uid()) a jornada nasce órfã.
--
-- Regras (spec 2026-07-26):
--   * pool = membros do SETOR do pipeline da fase (support_department_members);
--   * estratégia configurável por setor: menor_carga (padrão) | round_robin | fixo;
--   * sem teto de jornadas por pessoa — decisão do owner;
--   * a virada para implantação NÃO passa por aqui: lá a responsabilidade vai
--     para quem conduziu o treino (migration 20260726094000).

-- ==========================================================================
-- 1. Setor por pipeline
-- ==========================================================================

ALTER TABLE public.onboarding_pipelines
  ADD COLUMN IF NOT EXISTS department_id uuid
    REFERENCES public.support_departments(id) ON DELETE SET NULL;

-- ==========================================================================
-- 2. Regra de distribuição por setor
--
-- Tabela própria, e não `assignment_rules`: fn_assign_conversation_if_ready
-- seleciona a regra com `WHERE tenant_id AND department_id AND is_active LIMIT 1`,
-- sem nenhum filtro de escopo. Uma linha de onboarding gravada lá seria capturada
-- pelo motor do chat e passaria a mandar na distribuição de conversas do setor.
-- ==========================================================================

CREATE TABLE IF NOT EXISTS public.onboarding_assignment_rules (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  department_id          uuid NOT NULL REFERENCES public.support_departments(id) ON DELETE CASCADE,
  strategy               text NOT NULL DEFAULT 'menor_carga',
  fixed_agent_id         uuid NULL,
  excluded_agents        uuid[] NOT NULL DEFAULT '{}',
  round_robin_last_index integer NOT NULL DEFAULT -1,
  is_active              boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_assignment_rules_strategy_check
    CHECK (strategy IN ('menor_carga','round_robin','fixo')),
  CONSTRAINT onboarding_assignment_rules_tenant_dept_key UNIQUE (tenant_id, department_id)
);

ALTER TABLE public.onboarding_assignment_rules ENABLE ROW LEVEL SECURITY;

-- `TO authenticated` segue o padrão das demais tabelas do módulo: sem isso a
-- policy vale para `public` e o role anon estoura "permission denied for
-- function can_access_tenant_row" em vez de simplesmente não ver linha nenhuma.
DROP POLICY IF EXISTS onboarding_assignment_rules_sel ON public.onboarding_assignment_rules;
CREATE POLICY onboarding_assignment_rules_sel ON public.onboarding_assignment_rules
  FOR SELECT TO authenticated USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_assignment_rules_ins ON public.onboarding_assignment_rules;
CREATE POLICY onboarding_assignment_rules_ins ON public.onboarding_assignment_rules
  FOR INSERT TO authenticated WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_assignment_rules_upd ON public.onboarding_assignment_rules;
CREATE POLICY onboarding_assignment_rules_upd ON public.onboarding_assignment_rules
  FOR UPDATE TO authenticated USING (public.can_access_tenant_row(tenant_id))
                          WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onboarding_assignment_rules_del ON public.onboarding_assignment_rules;
CREATE POLICY onboarding_assignment_rules_del ON public.onboarding_assignment_rules
  FOR DELETE TO authenticated USING (public.can_access_tenant_row(tenant_id));

-- set_updated_at_ts() do projeto escreve em `atualizado_em`, que esta tabela não
-- tem. Trigger própria, mínima.
CREATE OR REPLACE FUNCTION public.fn_touch_onboarding_assignment_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_touch_onboarding_assignment_rules ON public.onboarding_assignment_rules;
CREATE TRIGGER trg_touch_onboarding_assignment_rules
  BEFORE UPDATE ON public.onboarding_assignment_rules
  FOR EACH ROW EXECUTE FUNCTION public.fn_touch_onboarding_assignment_rules();

-- ==========================================================================
-- 3. O motor: quem recebe a próxima jornada
--
-- Sem presença/heartbeat de propósito. O motor do chat exige agente online
-- porque a conversa precisa de alguém agora; jornada de onboarding dura dias —
-- exigir "online neste instante" faria a jornada criada às 19h30 nascer órfã.
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.fn_onboarding_pick_assignee(
  p_tenant_id     uuid,
  p_department_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule      public.onboarding_assignment_rules%ROWTYPE;
  v_tem_regra boolean := false;
  v_strategy  text := 'menor_carga';
  v_excluidos uuid[] := '{}';
  v_cands     uuid[];
  v_idx       int;
  v_escolhido uuid;
BEGIN
  IF p_tenant_id IS NULL OR p_department_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- FOR UPDATE serializa o round_robin: duas jornadas criadas ao mesmo tempo não
  -- podem ler o mesmo round_robin_last_index e cair na mesma pessoa.
  SELECT * INTO v_rule
    FROM public.onboarding_assignment_rules
   WHERE tenant_id = p_tenant_id
     AND department_id = p_department_id
     AND is_active
   FOR UPDATE;

  IF FOUND THEN
    v_tem_regra := true;
    v_strategy  := COALESCE(v_rule.strategy, 'menor_carga');
    v_excluidos := COALESCE(v_rule.excluded_agents, '{}');
  END IF;

  -- Pool: membro ativo do setor + profile ativo do tenant, menos os excluídos.
  SELECT ARRAY(
    SELECT m.user_id
      FROM public.support_department_members m
      JOIN public.profiles p
        ON p.user_id = m.user_id AND p.tenant_id = p_tenant_id
     WHERE m.department_id = p_department_id
       AND m.tenant_id = p_tenant_id
       AND m.is_active
       AND COALESCE(p.status, 'ativo') = 'ativo'
       AND NOT (m.user_id = ANY (v_excluidos))
     ORDER BY m.user_id
  ) INTO v_cands;

  IF v_cands IS NULL OR array_length(v_cands, 1) IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_tem_regra AND v_strategy = 'fixo'
     AND v_rule.fixed_agent_id IS NOT NULL
     AND v_rule.fixed_agent_id = ANY (v_cands) THEN
    RETURN v_rule.fixed_agent_id;
  END IF;

  IF v_tem_regra AND v_strategy = 'round_robin' THEN
    v_idx := (COALESCE(v_rule.round_robin_last_index, -1) + 1) % array_length(v_cands, 1);
    UPDATE public.onboarding_assignment_rules
       SET round_robin_last_index = v_idx
     WHERE id = v_rule.id;
    RETURN v_cands[v_idx + 1];
  END IF;

  -- menor_carga: padrão, e também o fallback de 'fixo' com o agente indisponível.
  -- Desempate por quem assumiu a última jornada há mais tempo — e NÃO por
  -- random() como no chat: com 3 a 6 pessoas e poucas jornadas, o random
  -- desequilibra de verdade em vez de se diluir no volume.
  SELECT u INTO v_escolhido
    FROM unnest(v_cands) AS u
   ORDER BY (
             SELECT count(*)
               FROM public.onboarding_journeys j
              WHERE j.tenant_id = p_tenant_id
                AND j.responsavel_user_id = u
                AND j.situacao NOT IN ('concluido', 'cancelado')
            ) ASC,
            COALESCE((
             SELECT max(h.de)
               FROM public.onboarding_responsavel_history h
              WHERE h.tenant_id = p_tenant_id AND h.user_id = u
            ), '-infinity'::timestamptz) ASC,
            u ASC
   LIMIT 1;

  RETURN v_escolhido;
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_pick_assignee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_pick_assignee(uuid, uuid) TO authenticated, service_role;

-- ==========================================================================
-- 4. Leitura para a UI: setor, regra e membros com a carga atual
-- ==========================================================================

CREATE OR REPLACE FUNCTION public.fn_onboarding_assignment_pool(
  p_tenant_id     uuid,
  p_department_id uuid   DEFAULT NULL,
  p_produto_id    bigint DEFAULT NULL,
  p_fase          text   DEFAULT 'onboarding'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dept      uuid := p_department_id;
  v_nome      text;
  v_strategy  text := 'menor_carga';
  v_fixo      uuid;
  v_excluidos uuid[] := '{}';
  v_membros   jsonb;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('department_id', NULL, 'department_nome', NULL,
                              'strategy', NULL, 'fixed_agent_id', NULL, 'membros', '[]'::jsonb);
  END IF;

  IF NOT public.can_access_tenant_row(p_tenant_id) THEN
    RAISE EXCEPTION 'sem permissao para este tenant';
  END IF;

  -- Sem setor explícito, resolve pelo pipeline da fase — a MESMA regra de escolha
  -- de pipeline usada por create_onboarding_journey.
  IF v_dept IS NULL THEN
    SELECT p.department_id INTO v_dept
      FROM public.onboarding_pipelines p
     WHERE p.tenant_id = p_tenant_id
       AND p.fase = p_fase::public.onb_fase
       AND p.ativo
       AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
       AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
     ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
     LIMIT 1;
  END IF;

  IF v_dept IS NULL THEN
    RETURN jsonb_build_object('department_id', NULL, 'department_nome', NULL,
                              'strategy', NULL, 'fixed_agent_id', NULL, 'membros', '[]'::jsonb);
  END IF;

  SELECT d.name INTO v_nome FROM public.support_departments d WHERE d.id = v_dept;

  SELECT r.strategy, r.fixed_agent_id, COALESCE(r.excluded_agents, '{}')
    INTO v_strategy, v_fixo, v_excluidos
    FROM public.onboarding_assignment_rules r
   WHERE r.tenant_id = p_tenant_id AND r.department_id = v_dept AND r.is_active;

  IF NOT FOUND THEN
    v_strategy := 'menor_carga';
    v_fixo := NULL;
    v_excluidos := '{}';
  END IF;

  SELECT COALESCE(jsonb_agg(s.x ORDER BY s.ordem), '[]'::jsonb) INTO v_membros
    FROM (
      SELECT COALESCE(f.nome, 'Sem vínculo') AS ordem,
             jsonb_build_object(
               'user_id', m.user_id,
               'nome', COALESCE(f.nome, 'Sem vínculo'),
               'jornadas_ativas', (
                 SELECT count(*)
                   FROM public.onboarding_journeys j
                  WHERE j.tenant_id = p_tenant_id
                    AND j.responsavel_user_id = m.user_id
                    AND j.situacao NOT IN ('concluido', 'cancelado')
               ),
               'no_rodizio', NOT (m.user_id = ANY (v_excluidos))
             ) AS x
        FROM public.support_department_members m
        JOIN public.profiles pr
          ON pr.user_id = m.user_id AND pr.tenant_id = p_tenant_id
        LEFT JOIN public.funcionarios f ON f.id = pr.funcionario_id
       WHERE m.department_id = v_dept
         AND m.tenant_id = p_tenant_id
         AND m.is_active
         AND COALESCE(pr.status, 'ativo') = 'ativo'
    ) s;

  RETURN jsonb_build_object(
    'department_id', v_dept,
    'department_nome', v_nome,
    'strategy', v_strategy,
    'fixed_agent_id', v_fixo,
    'membros', v_membros
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text) TO authenticated, service_role;

-- ==========================================================================
-- 5. create_onboarding_journey: definição corrente do banco com 3 mudanças
--      a) o ticket herda o setor do pipeline de onboarding;
--      b) sem implantador informado E com setor configurado, o motor escolhe —
--         auth.uid() deixa de participar (é ele que faz "quem criou vira dono");
--      c) quando a escolha foi automática, o período do histórico nasce com
--         motivo e um evento de auditoria é gravado.
--    Sem setor configurado, mantém auth.uid(): senão todo tenant que ainda não
--    configurou passaria a criar jornada órfã — regressão.
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
  v_dept uuid; v_auto boolean := false;
  v_strategy text; v_dept_nome text; v_motivo text; v_carga int; v_nome text;
BEGIN
  IF NOT public.can_access_tenant_row(p_tenant_id) THEN RAISE EXCEPTION 'sem permissao para este tenant'; END IF;

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

  -- setor da fase: define o pool da distribuicao e vai para o ticket
  SELECT p.department_id INTO v_dept FROM public.onboarding_pipelines p WHERE p.id = v_pipe_onb;
  v_dept := COALESCE(p_department_id, v_dept);

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
