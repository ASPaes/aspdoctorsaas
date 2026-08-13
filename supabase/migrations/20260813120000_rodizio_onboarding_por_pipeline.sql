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
