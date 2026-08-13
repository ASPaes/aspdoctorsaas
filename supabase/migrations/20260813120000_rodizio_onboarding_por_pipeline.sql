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

-- ==========================================================================
-- 5. create_onboarding_journey: distribui pelo PIPELINE que ela já resolveu.
--
-- Por que PATCH e não CREATE OR REPLACE com o corpo inteiro:
-- em 13/08/2026 a definição de produção (md5 141949e5…) e a do banco local
-- (md5 621e31c6…) JÁ eram diferentes — o local tem `fn_onb_pipeline_do_trilho`,
-- de outra sessão, que ainda não subiu para produção. Escrever o corpo inteiro
-- aqui apagaria o trabalho de quem chegasse primeiro, nos dois sentidos.
--
-- Lendo `pg_get_functiondef` na hora do apply, a migration acerta os dois bancos
-- e sobrevive a qualquer ordem entre as duas migrations. Cada troca é exata e
-- tem asserção: se o texto não bater, a migration ESTOURA em vez de aplicar pela
-- metade e deixar a distribuição em silêncio.
--
-- Mudanças: (a) v_tem_distribuicao decide quando distribuir; (b) passa v_pipe_onb
-- em vez de v_dept; (c) o motivo e o evento citam o pipeline. O setor continua
-- indo para o ticket, e a assinatura não muda.
-- ==========================================================================

DO $migration$
DECLARE
  v_def   text;
  v_novo  text;
  v_antes text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'create_onboarding_journey';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'create_onboarding_journey nao existe neste banco';
  END IF;

  -- idempotência: já migrada, não mexe
  IF position('fn_onboarding_pick_assignee(p_tenant_id, v_pipe_onb)' in v_def) > 0 THEN
    RAISE NOTICE 'create_onboarding_journey ja distribui pelo pipeline; nada a fazer';
    RETURN;
  END IF;

  v_novo := v_def;

  -- (a) declarações novas
  v_antes := v_novo;
  v_novo := replace(v_novo,
    '  v_dept uuid; v_auto boolean := false;',
    E'  v_dept uuid; v_auto boolean := false;\n  v_pipe_nome text; v_tem_distribuicao boolean;');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch a (declaracoes) nao encontrou o alvo'; END IF;

  -- (a) o pipeline tem lista própria? NÃO pode virar "v_pipe_onb IS NOT NULL":
  -- ele nunca é nulo aqui (a guarda de v_first_stage já estourou antes), o ELSE
  -- viraria código morto e todo tenant sem configuração criaria jornada órfã.
  v_antes := v_novo;
  v_novo := replace(v_novo,
    '  v_dept := COALESCE(p_department_id, v_dept);',
    E'  v_dept := COALESCE(p_department_id, v_dept);\n\n  SELECT EXISTS (\n           SELECT 1 FROM public.onboarding_assignment_rules r\n            WHERE r.tenant_id = p_tenant_id AND r.pipeline_id = v_pipe_onb AND r.is_active\n              AND array_length(COALESCE(r.included_agents, ''{}''), 1) IS NOT NULL\n         ) INTO v_tem_distribuicao;');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch a2 (v_tem_distribuicao) nao encontrou o alvo'; END IF;

  v_antes := v_novo;
  v_novo := replace(v_novo,
    '  ELSIF v_dept IS NOT NULL THEN',
    '  ELSIF v_tem_distribuicao OR v_dept IS NOT NULL THEN');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch a3 (ELSIF) nao encontrou o alvo'; END IF;

  -- (b) o motor recebe o pipeline
  v_antes := v_novo;
  v_novo := replace(v_novo,
    'public.fn_onboarding_pick_assignee(p_tenant_id, v_dept)',
    'public.fn_onboarding_pick_assignee(p_tenant_id, v_pipe_onb)');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch b (chamada do motor) nao encontrou o alvo'; END IF;

  -- (c) a regra agora é do pipeline, e é o pipeline que aparece no motivo
  v_antes := v_novo;
  v_novo := replace(v_novo,
    'SELECT COALESCE(r.strategy, ''menor_carga''), d.name',
    'SELECT COALESCE(r.strategy, ''menor_carga''), p.nome');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c1 (select da regra) nao encontrou o alvo'; END IF;

  v_antes := v_novo;
  v_novo := replace(v_novo, '        INTO v_strategy, v_dept_nome', '        INTO v_strategy, v_pipe_nome');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c2 (INTO) nao encontrou o alvo'; END IF;

  v_antes := v_novo;
  v_novo := replace(v_novo, '        FROM public.support_departments d', '        FROM public.onboarding_pipelines p');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c3 (FROM) nao encontrou o alvo'; END IF;

  v_antes := v_novo;
  v_novo := replace(v_novo,
    'ON r.tenant_id = p_tenant_id AND r.department_id = d.id AND r.is_active',
    'ON r.tenant_id = p_tenant_id AND r.pipeline_id = p.id AND r.is_active');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c4 (JOIN) nao encontrou o alvo'; END IF;

  v_antes := v_novo;
  v_novo := replace(v_novo, '       WHERE d.id = v_dept;', '       WHERE p.id = v_pipe_onb;');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c5 (WHERE) nao encontrou o alvo'; END IF;

  v_antes := v_novo;
  v_novo := replace(v_novo,
    '|| '' · setor '' || COALESCE(v_dept_nome, ''—'')',
    '|| '' · pipeline '' || COALESCE(v_pipe_nome, ''—'')');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c6 (motivo) nao encontrou o alvo'; END IF;

  -- (c) o evento de auditoria também passa a dizer de qual pipeline veio
  v_antes := v_novo;
  v_novo := replace(v_novo,
    '              || '' · carga antes desta jornada: '' || v_carga,',
    E'              || '' · pipeline '' || COALESCE(v_pipe_nome, ''—'')\n              || '' · carga antes desta jornada: '' || v_carga,');
  IF v_novo = v_antes THEN RAISE EXCEPTION 'patch c7 (evento) nao encontrou o alvo'; END IF;

  EXECUTE v_novo;

  -- confere o resultado em vez de confiar no replace
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_onboarding_journey';

  IF position('fn_onboarding_pick_assignee(p_tenant_id, v_pipe_onb)' in v_def) = 0
     OR position('v_tem_distribuicao' in v_def) = 0
     OR position('r.department_id' in v_def) > 0 THEN
    RAISE EXCEPTION 'create_onboarding_journey nao ficou como esperado depois do patch';
  END IF;

  RAISE NOTICE 'create_onboarding_journey: distribuicao migrada para pipeline';
END $migration$;

-- ==========================================================================
-- 6. Leitura para a UI: pipeline, regra e participantes com a carga atual.
--
-- DROP + CREATE: a assinatura antiga é (uuid, uuid, bigint, text) — os MESMOS tipos —
-- e o 2º parâmetro deixa de ser setor. O REPLACE recusaria a renomeação.
-- ==========================================================================

DROP FUNCTION IF EXISTS public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text);

CREATE OR REPLACE FUNCTION public.fn_onboarding_assignment_pool(
  p_tenant_id   uuid,
  p_pipeline_id uuid   DEFAULT NULL,
  p_produto_id  bigint DEFAULT NULL,
  p_fase        text   DEFAULT 'onboarding'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipe      uuid := p_pipeline_id;
  v_pipe_nome text;
  v_dept      uuid;
  v_dept_nome text;
  v_strategy  text := 'menor_carga';
  v_fixo      uuid;
  v_incluidos uuid[] := '{}';
  v_origem    text;
  v_membros   jsonb;
  v_vazio     jsonb := jsonb_build_object(
                'pipeline_id', NULL, 'pipeline_nome', NULL,
                'department_id', NULL, 'department_nome', NULL,
                'strategy', NULL, 'fixed_agent_id', NULL,
                'origem', NULL, 'membros', '[]'::jsonb);
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN v_vazio;
  END IF;

  IF NOT public.can_access_tenant_row(p_tenant_id) THEN
    RAISE EXCEPTION 'sem permissao para este tenant';
  END IF;

  -- Sem pipeline explícito, resolve pela fase/produto com a MESMA regra de
  -- create_onboarding_journey — senão a prévia da tela mente sobre quem vai receber.
  IF v_pipe IS NULL THEN
    SELECT p.id INTO v_pipe
      FROM public.onboarding_pipelines p
     WHERE p.tenant_id = p_tenant_id
       AND p.fase = p_fase::public.onb_fase
       AND p.ativo
       AND (p.produto_id = p_produto_id OR p.produto_id IS NULL)
       AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
     ORDER BY (p.produto_id = p_produto_id) DESC NULLS LAST, p.position
     LIMIT 1;
  END IF;

  IF v_pipe IS NULL THEN
    RETURN v_vazio;
  END IF;

  SELECT p.nome, p.department_id INTO v_pipe_nome, v_dept
    FROM public.onboarding_pipelines p
   WHERE p.id = v_pipe AND p.tenant_id = p_tenant_id;

  -- pipeline de outro tenant: não vaza nome nem membros
  IF v_pipe_nome IS NULL THEN
    RETURN v_vazio;
  END IF;

  SELECT d.name INTO v_dept_nome FROM public.support_departments d WHERE d.id = v_dept;

  SELECT r.strategy, r.fixed_agent_id, COALESCE(r.included_agents, '{}')
    INTO v_strategy, v_fixo, v_incluidos
    FROM public.onboarding_assignment_rules r
   WHERE r.tenant_id = p_tenant_id AND r.pipeline_id = v_pipe AND r.is_active;

  IF NOT FOUND THEN
    v_strategy := 'menor_carga';
    v_fixo := NULL;
    v_incluidos := '{}';
  END IF;

  IF array_length(v_incluidos, 1) IS NOT NULL THEN
    -- lista explícita: sai na ORDEM do array, que é a ordem do rodízio
    v_origem := 'lista';
    SELECT COALESCE(jsonb_agg(s.x ORDER BY s.ord), '[]'::jsonb) INTO v_membros
      FROM (
        SELECT t.ord,
               jsonb_build_object(
                 'user_id', t.u,
                 'nome', COALESCE(f.nome, 'Sem vínculo'),
                 'jornadas_ativas', (
                   SELECT count(*)
                     FROM public.onboarding_journeys j
                    WHERE j.tenant_id = p_tenant_id
                      AND j.responsavel_user_id = t.u
                      AND j.situacao NOT IN ('concluido', 'cancelado')
                 )
               ) AS x
          FROM unnest(v_incluidos) WITH ORDINALITY AS t(u, ord)
          JOIN public.profiles pr ON pr.user_id = t.u AND pr.tenant_id = p_tenant_id
          LEFT JOIN public.funcionarios f ON f.id = pr.funcionario_id
         WHERE COALESCE(pr.status, 'ativo') = 'ativo'
      ) s;
  ELSE
    -- fallback: a equipe do setor do pipeline, em ordem alfabética
    v_origem := 'setor';
    SELECT COALESCE(jsonb_agg(s.x ORDER BY s.ord), '[]'::jsonb) INTO v_membros
      FROM (
        SELECT COALESCE(f.nome, 'Sem vínculo') AS ord,
               jsonb_build_object(
                 'user_id', m.user_id,
                 'nome', COALESCE(f.nome, 'Sem vínculo'),
                 'jornadas_ativas', (
                   SELECT count(*)
                     FROM public.onboarding_journeys j
                    WHERE j.tenant_id = p_tenant_id
                      AND j.responsavel_user_id = m.user_id
                      AND j.situacao NOT IN ('concluido', 'cancelado')
                 )
               ) AS x
          FROM public.support_department_members m
          JOIN public.profiles pr ON pr.user_id = m.user_id AND pr.tenant_id = p_tenant_id
          LEFT JOIN public.funcionarios f ON f.id = pr.funcionario_id
         WHERE m.department_id = v_dept
           AND m.tenant_id = p_tenant_id
           AND m.is_active
           AND COALESCE(pr.status, 'ativo') = 'ativo'
      ) s;
  END IF;

  RETURN jsonb_build_object(
    'pipeline_id', v_pipe,
    'pipeline_nome', v_pipe_nome,
    'department_id', v_dept,
    'department_nome', v_dept_nome,
    'strategy', v_strategy,
    'fixed_agent_id', v_fixo,
    'origem', v_origem,
    'membros', v_membros
  );
END $$;

REVOKE ALL ON FUNCTION public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onboarding_assignment_pool(uuid, uuid, bigint, text) TO authenticated, service_role;
