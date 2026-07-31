-- Asserções do quadro padrão da jornada de Acompanhamento (31/07).
-- Ativar a jornada monta o quadro; ativar de novo não duplica; quem já tem cadastro não é tocado.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/19_acompanhamento_pipeline_padrao.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid; v_phase uuid; v_uid uuid;
  v_pipe uuid; v_pipe2 uuid; v_qtd int; v_antes int; v_txt text; v_bool boolean;
  v_digi uuid; v_digi_pipe uuid; v_digi_etapas int;
  v_sel uuid;
BEGIN
  -- ── tenant de teste: jornada de Acompanhamento inativa e SEM pipeline nenhum nela
  SELECT t.id, f.id INTO v_tenant, v_phase
    FROM public.tenants t
    JOIN public.onboarding_phases f ON f.tenant_id = t.id AND f.slug = 'acompanhamento' AND NOT f.ativo
   WHERE NOT EXISTS (SELECT 1 FROM public.onboarding_pipelines p WHERE p.phase_id = f.id)
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.tenant_id = t.id AND p.role IN ('admin','head'))
   ORDER BY t.nome LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'PRE: nenhum tenant com a jornada inativa e sem pipeline'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;

  -- estado da Digi Office ANTES (o tenant que já tem cadastro próprio)
  SELECT t.id INTO v_digi FROM public.tenants t WHERE t.nome = 'Digi Office Sistemas';
  SELECT p.id, (SELECT count(*) FROM public.onboarding_stages s WHERE s.pipeline_id = p.id)
    INTO v_digi_pipe, v_digi_etapas
    FROM public.onboarding_pipelines p
    JOIN public.onboarding_phases f ON f.id = p.phase_id AND f.slug = 'acompanhamento'
   WHERE p.tenant_id = v_digi LIMIT 1;

  -- ── 0. antes de ativar, advance_onboarding_phase não teria pipeline para escolher
  --      (mesma seleção de 20260729110000: ativo + com etapa ativa)
  SELECT p.id INTO v_sel FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.phase_id = v_phase AND p.ativo
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY p.position LIMIT 1;
  IF v_sel IS NOT NULL THEN RAISE EXCEPTION 'PRE: tenant de teste já tinha pipeline selecionável'; END IF;

  -- ── 1. ativar a jornada COMO USUÁRIO AUTENTICADO monta o quadro
  --      (o INSERT roda dentro de função SECURITY DEFINER; se dependesse da RLS do usuário, falharia)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  UPDATE public.onboarding_phases SET ativo = true WHERE id = v_phase;
  RESET role;

  SELECT p.id INTO v_pipe FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.phase_id = v_phase;
  IF v_pipe IS NULL THEN RAISE EXCEPTION 'FALHOU 1: ativar a jornada não criou pipeline'; END IF;

  SELECT nome INTO v_txt FROM public.onboarding_pipelines WHERE id = v_pipe;
  IF v_txt <> 'Acompanhamento de uso' THEN
    RAISE EXCEPTION 'FALHOU 1b: pipeline nasceu com nome "%"', v_txt;
  END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id = v_pipe;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 1c: esperava 4 etapas, veio %', v_qtd; END IF;

  -- ── 2. ordem e slugs exatos
  SELECT string_agg(slug, ',' ORDER BY position) INTO v_txt
    FROM public.onboarding_stages WHERE pipeline_id = v_pipe;
  IF v_txt <> 'primeiras-semanas,uso-em-ritmo,sinal-de-risco,cliente-destravado' THEN
    RAISE EXCEPTION 'FALHOU 2: ordem das etapas veio "%"', v_txt;
  END IF;

  -- ── 3. flags: exatamente uma inicial, exatamente uma final, e nas pontas certas
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND is_initial;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 3a: % etapas iniciais', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND is_final;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 3b: % etapas finais', v_qtd; END IF;

  SELECT is_initial INTO v_bool FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND slug = 'primeiras-semanas';
  IF v_bool IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 3c: "Primeiras semanas" não é a inicial'; END IF;
  SELECT is_final INTO v_bool FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND slug = 'cliente-destravado';
  IF v_bool IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 3d: "Cliente destravado" não é a final'; END IF;

  -- ── 4. sem SLA em lugar nenhum (o relógio da jornada não reinicia nesta fase)
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND (sla_minutos IS NOT NULL OR inicia_sla);
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4a: % etapas com SLA/gatilho', v_qtd; END IF;
  IF (SELECT sla_total_minutos FROM public.onboarding_pipelines WHERE id = v_pipe) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU 4b: pipeline nasceu com SLA total';
  END IF;

  -- ── 5. a seção de indicadores aparece em todas as etapas
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND NOT ('acompanhamento' = ANY(visible_sections));
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 5: % etapas sem a seção de indicadores', v_qtd; END IF;

  -- ── 6. o pipeline é genérico (serve qualquer produto) e sem enum legado
  SELECT count(*) INTO v_qtd FROM public.onboarding_pipelines
   WHERE id = v_pipe AND produto_id IS NULL AND department_id IS NULL AND fase IS NULL AND ativo;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6: pipeline não nasceu genérico/ativo'; END IF;

  -- ── 7. advance_onboarding_phase agora tem pipeline para escolher
  SELECT p.id INTO v_sel FROM public.onboarding_pipelines p
   WHERE p.tenant_id = v_tenant AND p.phase_id = v_phase AND p.ativo
     AND EXISTS (SELECT 1 FROM public.onboarding_stages s WHERE s.pipeline_id = p.id AND s.ativo)
   ORDER BY p.position LIMIT 1;
  IF v_sel IS DISTINCT FROM v_pipe THEN
    RAISE EXCEPTION 'FALHOU 7: a seleção de advance_onboarding_phase não achou o pipeline padrão';
  END IF;

  -- ── 8. desativar e reativar NÃO duplica (guarda de idempotência)
  UPDATE public.onboarding_phases SET ativo = false WHERE id = v_phase;
  UPDATE public.onboarding_phases SET ativo = true  WHERE id = v_phase;
  SELECT count(*) INTO v_qtd FROM public.onboarding_pipelines
   WHERE tenant_id = v_tenant AND phase_id = v_phase;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 8a: reativar duplicou o pipeline (%)', v_qtd; END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id = v_pipe;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 8b: reativar duplicou etapas (%)', v_qtd; END IF;

  -- ── 9. chamar a função direto também é idempotente
  v_pipe2 := public.fn_seed_onboarding_acompanhamento_pipeline(v_tenant);
  IF v_pipe2 IS NOT NULL THEN RAISE EXCEPTION 'FALHOU 9: a função agiu com pipeline já existente'; END IF;

  -- ── 10. edição do tenant não é sobrescrita
  UPDATE public.onboarding_stages SET nome = 'Renomeado pelo tenant'
   WHERE pipeline_id = v_pipe AND slug = 'uso-em-ritmo';
  DELETE FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND slug = 'sinal-de-risco';
  UPDATE public.onboarding_phases SET ativo = false WHERE id = v_phase;
  UPDATE public.onboarding_phases SET ativo = true  WHERE id = v_phase;
  SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id = v_pipe;
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 10a: o padrão ressuscitou etapa apagada (% etapas)', v_qtd; END IF;
  SELECT nome INTO v_txt FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe AND slug = 'uso-em-ritmo';
  IF v_txt <> 'Renomeado pelo tenant' THEN
    RAISE EXCEPTION 'FALHOU 10b: o padrão sobrescreveu o nome editado ("%")', v_txt;
  END IF;

  -- ── 11. quem já tinha cadastro continua intacto
  IF v_digi_pipe IS NOT NULL THEN
    PERFORM public.fn_seed_onboarding_acompanhamento_pipeline(v_digi);
    SELECT count(*) INTO v_qtd FROM public.onboarding_pipelines p
      JOIN public.onboarding_phases f ON f.id = p.phase_id AND f.slug = 'acompanhamento'
     WHERE p.tenant_id = v_digi;
    IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 11a: Digi Office ficou com % pipelines', v_qtd; END IF;
    SELECT count(*) INTO v_qtd FROM public.onboarding_stages WHERE pipeline_id = v_digi_pipe;
    IF v_qtd <> v_digi_etapas THEN
      RAISE EXCEPTION 'FALHOU 11b: etapas da Digi Office mudaram (% -> %)', v_digi_etapas, v_qtd;
    END IF;
  END IF;

  -- ── 12. o gatilho é só da fase Acompanhamento: religar outra jornada não cria nada
  SELECT count(*) INTO v_antes FROM public.onboarding_pipelines p
    JOIN public.onboarding_phases f ON f.id = p.phase_id
   WHERE p.tenant_id = v_tenant AND f.slug = 'onboarding';
  UPDATE public.onboarding_phases SET ativo = false
   WHERE tenant_id = v_tenant AND slug = 'onboarding';
  UPDATE public.onboarding_phases SET ativo = true
   WHERE tenant_id = v_tenant AND slug = 'onboarding';
  SELECT count(*) INTO v_qtd FROM public.onboarding_pipelines p
    JOIN public.onboarding_phases f ON f.id = p.phase_id
   WHERE p.tenant_id = v_tenant AND f.slug = 'onboarding';
  IF v_qtd <> v_antes THEN
    RAISE EXCEPTION 'FALHOU 12: religar a jornada de Onboarding mexeu nos pipelines dela (% -> %)', v_antes, v_qtd;
  END IF;

  RAISE NOTICE 'OK — 12 asserções passaram (tenant de teste: %)', v_tenant;
END $$;

ROLLBACK;
