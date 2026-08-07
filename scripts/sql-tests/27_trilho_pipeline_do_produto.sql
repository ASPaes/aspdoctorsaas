-- O trilho tem que escolher o MESMO pipeline que create_onboarding_journey escolhe.
-- Bug de 07/08: fn_onb_trilho_sla_min/_resumo não filtravam por produto, e em
-- `ORDER BY (produto_id = p_produto_id) DESC NULLS LAST` o `false` (pipeline de OUTRO
-- produto) vem antes do NULL (pipeline genérico). Resultado: a jornada entrava no quadro
-- certo e o go-live saía do quadro de outro produto.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/27_trilho_pipeline_do_produto.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_prod_generico bigint; v_prod_dedicado bigint;
  v_phase uuid; v_pipe_generico uuid; v_pipe_dedicado uuid;
  v_esperado int; v_total int; v_total_dedicado int; v_resumo jsonb;
  v_pipe_criacao uuid; v_inicia_nome text;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: tenant Digi Office não encontrado'; END IF;

  -- fase que tem, ao mesmo tempo, um pipeline genérico (produto NULL) e um de produto
  -- específico — os dois com etapas. É a configuração que dispara o bug.
  SELECT ph.id,
         (SELECT p.id FROM public.onboarding_pipelines p
           WHERE p.tenant_id = v_tenant AND p.phase_id = ph.id AND p.ativo AND p.produto_id IS NULL
             AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
           ORDER BY p.position LIMIT 1),
         (SELECT p.id FROM public.onboarding_pipelines p
           WHERE p.tenant_id = v_tenant AND p.phase_id = ph.id AND p.ativo AND p.produto_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
           ORDER BY p.position LIMIT 1)
    INTO v_phase, v_pipe_generico, v_pipe_dedicado
    FROM public.onboarding_phases ph
   WHERE ph.tenant_id = v_tenant AND ph.ativo
   ORDER BY ph.position;

  IF v_pipe_generico IS NULL OR v_pipe_dedicado IS NULL THEN
    RAISE EXCEPTION 'PRE: nenhuma fase com pipeline genérico E pipeline de produto ao mesmo tempo';
  END IF;

  SELECT produto_id INTO v_prod_dedicado FROM public.onboarding_pipelines WHERE id = v_pipe_dedicado;

  -- produto do tenant que NÃO tem pipeline próprio: tem que cair no genérico
  SELECT pr.id INTO v_prod_generico FROM public.produtos pr
   WHERE pr.tenant_id = v_tenant
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_pipelines p
                      WHERE p.tenant_id = v_tenant AND p.produto_id = pr.id AND p.ativo)
   ORDER BY pr.id LIMIT 1;
  IF v_prod_generico IS NULL THEN RAISE EXCEPTION 'PRE: todo produto do tenant tem pipeline próprio'; END IF;

  -- soma esperada: mesma janela, mas escolhendo o pipeline como create_onboarding_journey escolhe
  WITH trilho AS (
    SELECT ph.position AS fpos,
           (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = v_tenant AND p.phase_id = ph.id AND p.ativo
               AND (p.produto_id = v_prod_generico OR p.produto_id IS NULL)
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = v_prod_generico) DESC NULLS LAST, p.position LIMIT 1) AS pid
      FROM public.onboarding_phases ph WHERE ph.tenant_id = v_tenant AND ph.ativo
  ), etapas AS (
    SELECT s.sla_minutos,
           COALESCE(s.inicia_sla,false) AS inicia, COALESCE(s.encerra_sla,false) AS encerra,
           COALESCE(s.pausa_sla,false) AS pausa,
           row_number() OVER (ORDER BY t.fpos, s.position) AS ord
      FROM trilho t JOIN public.onboarding_stages s ON s.pipeline_id = t.pid AND s.ativo
  ), janela AS (
    SELECT COALESCE(min(ord) FILTER (WHERE inicia), min(ord)) AS ini,
           COALESCE(min(ord) FILTER (WHERE encerra), max(ord)) AS fim FROM etapas
  )
  SELECT COALESCE(sum(e.sla_minutos),0) INTO v_esperado
    FROM etapas e CROSS JOIN janela j
   WHERE e.ord >= j.ini AND e.ord <= j.fim AND NOT e.pausa;

  -- 1. o total do trilho é o do pipeline do produto, não o do pipeline alheio
  v_total := public.fn_onb_trilho_sla_min(v_tenant, v_prod_generico);
  IF v_total <> v_esperado THEN
    RAISE EXCEPTION 'FALHA 1: trilho do produto % devolveu % min, esperado % min (pegou pipeline de outro produto)',
      v_prod_generico, v_total, v_esperado;
  END IF;

  -- 2. produto sem pipeline próprio e produto COM pipeline próprio não podem dar o mesmo total
  --    (as duas fases somam pipelines diferentes)
  v_total_dedicado := public.fn_onb_trilho_sla_min(v_tenant, v_prod_dedicado);
  IF (SELECT COALESCE(sum(sla_minutos),0) FROM public.onboarding_stages WHERE pipeline_id = v_pipe_generico AND ativo)
     <> (SELECT COALESCE(sum(sla_minutos),0) FROM public.onboarding_stages WHERE pipeline_id = v_pipe_dedicado AND ativo)
     AND v_total = v_total_dedicado THEN
    RAISE EXCEPTION 'FALHA 2: produto sem pipeline próprio (%) e produto dedicado (%) somaram o mesmo: % min',
      v_prod_generico, v_prod_dedicado, v_total;
  END IF;

  -- 3. a etapa que abre a contagem tem que ser de um pipeline do trilho do produto
  v_resumo := public.fn_onb_trilho_resumo(v_tenant, v_prod_generico);
  v_inicia_nome := v_resumo->>'inicia_nome';
  IF EXISTS (SELECT 1 FROM public.onboarding_stages s
              JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
             WHERE p.tenant_id = v_tenant AND s.nome = v_inicia_nome AND s.ativo
               AND p.produto_id IS NOT NULL AND p.produto_id <> v_prod_generico) THEN
    RAISE EXCEPTION 'FALHA 3: resumo abre a contagem em «%», etapa de pipeline de outro produto', v_inicia_nome;
  END IF;
  IF (v_resumo->>'total_min')::int <> v_esperado THEN
    RAISE EXCEPTION 'FALHA 3b: resumo somou % min, esperado %', v_resumo->>'total_min', v_esperado;
  END IF;

  -- 4. mesma escolha de create_onboarding_journey na fase de onboarding
  SELECT p.id INTO v_pipe_criacao FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.fase = 'onboarding' AND p.ativo
     AND (p.produto_id = v_prod_generico OR p.produto_id IS NULL)
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY (p.produto_id = v_prod_generico) DESC NULLS LAST, p.position LIMIT 1;
  IF v_pipe_criacao <> v_pipe_generico THEN
    RAISE EXCEPTION 'PRE 4: fixture mudou — criação escolheria % e não o genérico %', v_pipe_criacao, v_pipe_generico;
  END IF;

  RAISE NOTICE 'OK 27_trilho_pipeline_do_produto — produto % soma % min (genérico), produto % soma % min',
    v_prod_generico, v_total, v_prod_dedicado, v_total_dedicado;
END $$;

ROLLBACK;
