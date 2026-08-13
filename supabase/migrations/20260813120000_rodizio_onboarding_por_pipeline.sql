-- Rodízio do onboarding por PIPELINE, não por setor.
--
-- Problema (Digi Office, medido em 13/08/2026): "Onboarding PDV" e "Onboarding Gula"
-- apontam para o mesmo setor `Onboarding`, e a regra é UNIQUE (tenant_id, department_id).
-- Uma regra só governa os dois pipelines. Pior: quem faz o onboarding do Gula é o
-- "Fabricio Onboarding", do setor `Suporte Gula` — fora do pool. As 5 jornadas de Gula
-- que existem têm motivo IS NULL no histórico: nenhuma veio do motor, todas foram
-- atribuídas à mão.
--
-- E funcionarios.department_id é 1 setor por pessoa: mover o Fabricio para `Onboarding`
-- o tiraria do `Suporte Gula` e quebraria a distribuição de chat dele.
--
-- Decisão (spec 2026-08-13): a unidade de distribuição passa a ser o pipeline, com lista
-- explícita de participantes que pode incluir gente de fora do setor. O setor continua
-- saindo do pipeline e indo para o TICKET; só deixa de mandar em quem recebe.

-- ==========================================================================
-- 1. Colunas novas
-- ==========================================================================

ALTER TABLE public.onboarding_assignment_rules
  ADD COLUMN IF NOT EXISTS pipeline_id uuid
    REFERENCES public.onboarding_pipelines(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS included_agents uuid[] NOT NULL DEFAULT '{}';

-- A UNIQUE por setor precisa cair ANTES do backfill: as linhas novas nascem com
-- department_id nulo e várias por setor.
ALTER TABLE public.onboarding_assignment_rules
  DROP CONSTRAINT IF EXISTS onboarding_assignment_rules_tenant_dept_key;

ALTER TABLE public.onboarding_assignment_rules
  ALTER COLUMN department_id DROP NOT NULL;

-- ==========================================================================
-- 2. Backfill — comportamento idêntico no dia 1
--
-- Cada pipeline ativo do setor que tem regra hoje ganha uma cópia dela, com
-- included_agents = membros ativos do setor menos os que estavam excluídos, na
-- MESMA ordem que o motor usa hoje (ORDER BY user_id).
-- ==========================================================================

INSERT INTO public.onboarding_assignment_rules
  (tenant_id, pipeline_id, strategy, fixed_agent_id, included_agents,
   round_robin_last_index, is_active)
SELECT r.tenant_id,
       p.id,
       r.strategy,
       r.fixed_agent_id,
       ARRAY(
         SELECT m.user_id
           FROM public.support_department_members m
           JOIN public.profiles pr
             ON pr.user_id = m.user_id AND pr.tenant_id = r.tenant_id
          WHERE m.department_id = r.department_id
            AND m.tenant_id = r.tenant_id
            AND m.is_active
            AND COALESCE(pr.status, 'ativo') = 'ativo'
            AND NOT (m.user_id = ANY (COALESCE(r.excluded_agents, '{}')))
          ORDER BY m.user_id
       ),
       r.round_robin_last_index,
       r.is_active
  FROM public.onboarding_assignment_rules r
  JOIN public.onboarding_pipelines p
    ON p.tenant_id = r.tenant_id
   AND p.department_id = r.department_id
   AND p.ativo
 WHERE r.pipeline_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.onboarding_assignment_rules x
      WHERE x.tenant_id = r.tenant_id AND x.pipeline_id = p.id
   );

DELETE FROM public.onboarding_assignment_rules WHERE pipeline_id IS NULL;

-- ==========================================================================
-- 3. Fecha o modelo novo
-- ==========================================================================

ALTER TABLE public.onboarding_assignment_rules
  ALTER COLUMN pipeline_id SET NOT NULL;

ALTER TABLE public.onboarding_assignment_rules
  ADD CONSTRAINT onboarding_assignment_rules_tenant_pipeline_key
    UNIQUE (tenant_id, pipeline_id);

ALTER TABLE public.onboarding_assignment_rules
  DROP COLUMN IF EXISTS department_id,
  DROP COLUMN IF EXISTS excluded_agents;

-- ==========================================================================
-- 4. O motor: quem recebe a próxima jornada DESTE pipeline
--
-- DROP + CREATE, não CREATE OR REPLACE: os tipos são os mesmos (uuid, uuid) e só
-- o nome do 2º parâmetro muda, e o REPLACE recusa renomear parâmetro.
-- O DROP leva os grants junto — por isso o REVOKE/GRANT logo abaixo.
-- ==========================================================================

DROP FUNCTION IF EXISTS public.fn_onboarding_pick_assignee(uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_onboarding_pick_assignee(
  p_tenant_id   uuid,
  p_pipeline_id uuid
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
  v_incluidos uuid[] := '{}';
  v_dept      uuid;
  v_cands     uuid[];
  v_idx       int;
  v_escolhido uuid;
BEGIN
  -- guarda cross-tenant de 31/07 (20260731230000): NÃO remover.
  PERFORM public.assert_tenant_scope(p_tenant_id);

  IF p_tenant_id IS NULL OR p_pipeline_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- FOR UPDATE serializa o round_robin: duas jornadas criadas ao mesmo tempo não
  -- podem ler o mesmo round_robin_last_index e cair na mesma pessoa.
  SELECT * INTO v_rule
    FROM public.onboarding_assignment_rules
   WHERE tenant_id = p_tenant_id
     AND pipeline_id = p_pipeline_id
     AND is_active
   FOR UPDATE;

  IF FOUND THEN
    v_tem_regra := true;
    v_strategy  := COALESCE(v_rule.strategy, 'menor_carga');
    v_incluidos := COALESCE(v_rule.included_agents, '{}');
  END IF;

  IF array_length(v_incluidos, 1) IS NOT NULL THEN
    -- Lista explícita: a ordem do array É a ordem do rodízio, por isso o WITH ORDINALITY.
    -- Pode conter gente de fora do setor do pipeline — é o ponto da mudança.
    SELECT ARRAY(
      SELECT t.u
        FROM unnest(v_incluidos) WITH ORDINALITY AS t(u, ord)
       WHERE EXISTS (
               SELECT 1 FROM public.profiles p
                WHERE p.user_id = t.u
                  AND p.tenant_id = p_tenant_id
                  AND COALESCE(p.status, 'ativo') = 'ativo'
             )
       ORDER BY t.ord
    ) INTO v_cands;
  ELSE
    -- Fallback: membros do SETOR do pipeline. Nunca o tenant inteiro — sem lista
    -- configurada, distribuir para a empresa toda seria pior que não distribuir.
    SELECT p.department_id INTO v_dept
      FROM public.onboarding_pipelines p
     WHERE p.id = p_pipeline_id AND p.tenant_id = p_tenant_id;

    IF v_dept IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT ARRAY(
      SELECT m.user_id
        FROM public.support_department_members m
        JOIN public.profiles p
          ON p.user_id = m.user_id AND p.tenant_id = p_tenant_id
       WHERE m.department_id = v_dept
         AND m.tenant_id = p_tenant_id
         AND m.is_active
         AND COALESCE(p.status, 'ativo') = 'ativo'
       ORDER BY m.user_id
    ) INTO v_cands;
  END IF;

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
  -- A carga é a da PESSOA inteira, em todos os pipelines — é a carga real dela.
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
