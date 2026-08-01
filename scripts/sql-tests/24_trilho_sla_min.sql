-- fn_onb_trilho_sla_min: soma das etapas da JANELA contada, ao longo do trilho inteiro.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/24_trilho_sla_min.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_prod bigint; v_total int; v_soma int; v_e_meio uuid; v_parcial int;
  v_sla_meio int;
BEGIN
  SELECT t.id INTO v_tenant FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: tenant Digi Office não encontrado'; END IF;
  SELECT p.produto_id INTO v_prod FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.produto_id IS NOT NULL ORDER BY p.position LIMIT 1;

  -- 1. sem etapa marcada em nenhum ponto: janela = trilho inteiro (menos as de pausa)
  UPDATE public.onboarding_stages s SET encerra_sla = false
    FROM public.onboarding_pipelines p WHERE p.id = s.pipeline_id AND p.tenant_id = v_tenant;

  v_total := public.fn_onb_trilho_sla_min(v_tenant, v_prod);
  IF v_total IS NULL OR v_total <= 0 THEN RAISE EXCEPTION 'FALHA 1: trilho devolveu %', v_total; END IF;

  -- 2. bate com a soma manual dos pipelines escolhidos por jornada
  WITH trilho AS (
    SELECT (SELECT p.id FROM public.onboarding_pipelines p
             WHERE p.tenant_id = v_tenant AND p.phase_id = ph.id AND p.ativo
               AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
             ORDER BY (p.produto_id = v_prod) DESC NULLS LAST, p.position LIMIT 1) AS pid
      FROM public.onboarding_phases ph WHERE ph.tenant_id = v_tenant AND ph.ativo
  )
  SELECT COALESCE(sum(s.sla_minutos),0) INTO v_soma
    FROM trilho t JOIN public.onboarding_stages s ON s.pipeline_id = t.pid
   WHERE s.ativo AND NOT COALESCE(s.pausa_sla,false);
  IF v_total <> v_soma THEN RAISE EXCEPTION 'FALHA 2: fn devolveu %, soma manual %', v_total, v_soma; END IF;

  -- 3. marcar encerra_sla numa etapa do MEIO recorta a janela: total diminui
  SELECT s.id, s.sla_minutos INTO v_e_meio, v_sla_meio
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
    JOIN public.onboarding_phases ph ON ph.id = p.phase_id AND ph.position = 1
   WHERE p.tenant_id = v_tenant AND s.ativo AND s.sla_minutos > 0
     AND NOT COALESCE(s.pausa_sla,false)
   ORDER BY s.position OFFSET 1 LIMIT 1;
  IF v_e_meio IS NULL THEN RAISE EXCEPTION 'PRE 3: não achei etapa do meio na 1ª jornada'; END IF;

  UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_e_meio;
  v_parcial := public.fn_onb_trilho_sla_min(v_tenant, v_prod);
  IF v_parcial >= v_total THEN
    RAISE EXCEPTION 'FALHA 3: janela recortada devolveu % (>= trilho inteiro %)', v_parcial, v_total;
  END IF;

  -- 4. a etapa marcada ENTRA na janela (a contagem para ao ENTRAR nela, então ela conta)
  IF v_parcial < v_sla_meio THEN
    RAISE EXCEPTION 'FALHA 4: a própria etapa que encerra (% min) ficou fora da soma (%)', v_sla_meio, v_parcial;
  END IF;

  -- 5. tenant sem etapa nenhuma devolve 0, não NULL
  IF public.fn_onb_trilho_sla_min('00000000-0000-0000-0000-000000000000', NULL) IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FALHA 5: tenant inexistente não devolveu 0';
  END IF;

  RAISE NOTICE 'OK 24_trilho_sla_min — trilho % min, janela recortada % min', v_total, v_parcial;
END $$;

ROLLBACK;
