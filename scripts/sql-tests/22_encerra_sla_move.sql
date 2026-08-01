-- move_onboarding_stage: entrar na etapa marcada encerra; voltar reabre; avançar mantém.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/22_encerra_sla_move.sql
BEGIN;

DO $$
DECLARE
  v_j uuid; v_tenant uuid; v_ticket uuid; v_pipe uuid; v_uid uuid;
  v_e1 uuid; v_e2 uuid; v_e3 uuid; v_enc timestamptz; v_stage uuid; v_n int;
BEGIN
  -- jornada viva num pipeline com 3+ etapas ativas
  SELECT j.id, j.tenant_id, j.ticket_id, s.pipeline_id
    INTO v_j, v_tenant, v_ticket, v_pipe
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.situacao NOT IN ('concluido','cancelado')
     AND (SELECT count(*) FROM public.onboarding_stages x WHERE x.pipeline_id = s.pipeline_id AND x.ativo) >= 3
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE: nenhuma jornada viva em pipeline com 3+ etapas'; END IF;

  -- autentica como admin/head do tenant: move_onboarding_stage exige can_access_tenant_row
  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  IF v_uid IS NULL THEN RAISE EXCEPTION 'PRE: nenhum admin/head no tenant'; END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  SELECT id INTO v_e1 FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position LIMIT 1;
  SELECT id INTO v_e2 FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position OFFSET 1 LIMIT 1;
  SELECT id INTO v_e3 FROM public.onboarding_stages WHERE pipeline_id = v_pipe AND ativo ORDER BY position OFFSET 2 LIMIT 1;

  -- e2 encerra a contagem. Checklist obrigatório fora do caminho: p_force := true.
  UPDATE public.onboarding_stages SET encerra_sla = true WHERE id = v_e2;
  UPDATE public.onboarding_journeys
     SET current_stage_id = v_e1, sla_encerrado_em = NULL, sla_encerrado_stage_id = NULL
   WHERE id = v_j;

  -- 1. mover para e2 encerra
  PERFORM public.move_onboarding_stage(v_j, v_e2, '{}'::uuid[], true);
  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc, v_stage
    FROM public.onboarding_journeys WHERE id = v_j;
  IF v_enc IS NULL THEN RAISE EXCEPTION 'FALHA 1a: entrar na etapa marcada não encerrou'; END IF;
  IF v_stage IS DISTINCT FROM v_e2 THEN RAISE EXCEPTION 'FALHA 1b: stage do encerramento errado'; END IF;

  SELECT count(*) INTO v_n FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_sla_encerrado';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 1c: esperava 1 evento de encerramento, achei %', v_n; END IF;

  -- 2. AVANÇAR para e3 mantém encerrado, com o mesmo timestamp
  PERFORM public.move_onboarding_stage(v_j, v_e3, '{}'::uuid[], true);
  IF (SELECT sla_encerrado_em FROM public.onboarding_journeys WHERE id = v_j) IS DISTINCT FROM v_enc THEN
    RAISE EXCEPTION 'FALHA 2: avançar mexeu no marco de encerramento';
  END IF;

  -- 3. VOLTAR para e1 reabre
  PERFORM public.move_onboarding_stage(v_j, v_e1, '{}'::uuid[], true);
  SELECT sla_encerrado_em, sla_encerrado_stage_id INTO v_enc, v_stage
    FROM public.onboarding_journeys WHERE id = v_j;
  IF v_enc IS NOT NULL OR v_stage IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 3a: voltar etapa não reabriu a contagem';
  END IF;

  SELECT count(*) INTO v_n FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_sla_reaberto';
  IF v_n <> 1 THEN RAISE EXCEPTION 'FALHA 3b: esperava 1 evento de reabertura, achei %', v_n; END IF;

  -- 4. pipeline SEM etapa marcada: nada é gravado (comportamento de hoje preservado)
  UPDATE public.onboarding_stages SET encerra_sla = false WHERE id = v_e2;
  UPDATE public.onboarding_journeys SET current_stage_id = v_e1 WHERE id = v_j;
  PERFORM public.move_onboarding_stage(v_j, v_e2, '{}'::uuid[], true);
  IF (SELECT sla_encerrado_em FROM public.onboarding_journeys WHERE id = v_j) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 4: encerrou sem etapa marcada';
  END IF;

  RAISE NOTICE 'OK 22_encerra_sla_move — move';
END $$;

-- ── avanço de fase: gatilho respeitado e duração útil gravada ─────────────────
DO $$
DECLARE
  v_j uuid; v_tenant uuid; v_uid uuid; v_pipe_onb uuid; v_pipe_imp uuid;
  v_final_onb uuid; v_first_imp uuid; v_gatilho uuid; v_ini timestamptz;
  v_hist uuid; v_util int;
BEGIN
  -- jornada em onboarding, com pipeline de implantação que tem 2+ etapas
  SELECT j.id, j.tenant_id, s.pipeline_id, j.pipeline_implantacao_id
    INTO v_j, v_tenant, v_pipe_onb, v_pipe_imp
    FROM public.onboarding_journeys j
    JOIN public.onboarding_stages s ON s.id = j.current_stage_id
   WHERE j.fase_atual = 'onboarding'
     AND j.situacao NOT IN ('concluido','cancelado')
     AND j.pipeline_implantacao_id IS NOT NULL
     AND (SELECT count(*) FROM public.onboarding_stages x
           WHERE x.pipeline_id = j.pipeline_implantacao_id AND x.ativo) >= 2
     AND EXISTS (SELECT 1 FROM public.onboarding_stages x
                  WHERE x.pipeline_id = s.pipeline_id AND x.ativo AND x.is_final)
   LIMIT 1;
  IF v_j IS NULL THEN RAISE EXCEPTION 'PRE 5: nenhuma jornada em onboarding com implantação configurada'; END IF;

  SELECT p.user_id INTO v_uid FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.role IN ('admin','head') LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);

  SELECT id INTO v_final_onb FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_onb AND ativo AND is_final ORDER BY position LIMIT 1;

  -- primeira etapa da implantação, pela MESMA regra da função
  SELECT id INTO v_first_imp FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_imp AND ativo ORDER BY is_initial DESC, position LIMIT 1;

  -- fixture: o gatilho da implantação NÃO é a primeira etapa. É o caso que expõe o bug —
  -- em produção a 1ª etapa da Implantação PDV é a própria gatilho e mascara o problema.
  UPDATE public.onboarding_stages SET inicia_sla = false WHERE pipeline_id = v_pipe_imp;
  SELECT id INTO v_gatilho FROM public.onboarding_stages
   WHERE pipeline_id = v_pipe_imp AND ativo AND id <> v_first_imp ORDER BY position DESC LIMIT 1;
  UPDATE public.onboarding_stages SET inicia_sla = true WHERE id = v_gatilho;

  UPDATE public.onboarding_journeys
     SET sla_iniciado_em = NULL, current_stage_id = v_final_onb
   WHERE id = v_j;

  -- garante um histórico aberto na etapa final do onboarding, para conferir a duração útil
  UPDATE public.onboarding_stage_history SET saiu_em = now() WHERE journey_id = v_j AND saiu_em IS NULL;
  INSERT INTO public.onboarding_stage_history (tenant_id, journey_id, stage_id, entrou_em)
  VALUES (v_tenant, v_j, v_final_onb, now() - interval '3 days') RETURNING id INTO v_hist;

  PERFORM public.advance_onboarding_to_implantacao(v_j, true);

  -- 5. o relógio NÃO pode ter partido: a etapa de destino não é a gatilho
  SELECT sla_iniciado_em INTO v_ini FROM public.onboarding_journeys WHERE id = v_j;
  IF v_ini IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA 5: avanço de fase ligou o SLA ignorando a etapa gatilho';
  END IF;

  -- 6. a etapa fechada no avanço precisa sair com duração ÚTIL, não só corrida
  SELECT duracao_util_minutos INTO v_util FROM public.onboarding_stage_history WHERE id = v_hist;
  IF v_util IS NULL THEN
    RAISE EXCEPTION 'FALHA 6: avanço de fase fechou o histórico sem duracao_util_minutos';
  END IF;

  RAISE NOTICE 'OK 22_encerra_sla_move — avanço de fase';
END $$;

ROLLBACK;
