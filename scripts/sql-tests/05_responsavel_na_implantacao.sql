-- Asserções: ao concluir o onboarding, a responsabilidade passa para o
-- "Conduzido por" do treino mais recente, com motivo fixo.
BEGIN;

DO $$
DECLARE
  v_tenant   uuid;
  v_caller   uuid;
  v_cliente  uuid;
  v_jid      uuid;
  v_ticket   uuid;
  v_stage    uuid;
  v_tecnico  uuid;
  v_atual    uuid;
  v_ret      jsonb;
  v_qtd      int;
BEGIN
  SELECT j.tenant_id INTO v_tenant FROM public.onboarding_journeys j LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'SETUP: sem jornada no banco local'; END IF;

  SELECT p.user_id INTO v_caller FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL
     AND p.access_status = 'active' AND coalesce(p.status,'ativo') = 'ativo' LIMIT 1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_caller::text, 'role','authenticated')::text, true);

  SELECT c.id INTO v_cliente FROM public.clientes c WHERE c.tenant_id = v_tenant LIMIT 1;

  -- jornada nova, criada pela RPC (nasce com o chamador como responsável)
  v_jid := public.create_onboarding_journey(
    v_tenant, v_cliente, 'ZZ Teste responsavel automatico',
    NULL, now(), NULL, v_caller, NULL, NULL, NULL, NULL);
  SELECT ticket_id, current_stage_id, responsavel_user_id
    INTO v_ticket, v_stage, v_atual
    FROM public.onboarding_journeys WHERE id = v_jid;

  -- 1. a jornada nasce com responsável e período aberto
  IF v_atual IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'FALHOU 1: jornada nova nasceu sem o responsável correto';
  END IF;
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1b: jornada nova sem período aberto (%)' , v_qtd; END IF;

  -- técnico: alguém do tenant diferente do responsável atual
  SELECT p.user_id INTO v_tecnico FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL AND p.user_id <> v_atual
     AND p.access_status = 'active' AND coalesce(p.status,'ativo') = 'ativo' LIMIT 1;
  IF v_tecnico IS NULL THEN RAISE EXCEPTION 'SETUP: sem segundo usuário ativo'; END IF;

  -- 2. sem treino nenhum, concluir mantém o responsável atual (fallback do owner)
  UPDATE public.onboarding_stages SET is_final = true WHERE id = v_stage;
  v_ret := public.advance_onboarding_to_implantacao(v_jid, false, true);
  IF (v_ret->>'ok')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 2: advance sem treino não deveria falhar (%)', v_ret;
  END IF;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_jid AND responsavel_user_id = v_atual;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 2b: sem treino, o responsável deveria ter sido mantido'; END IF;

  -- volta para onboarding para testar o caminho com treino
  UPDATE public.onboarding_journeys
     SET fase_atual = 'onboarding', current_stage_id = v_stage,
         onboarding_concluido_em = NULL, implantacao_iniciada_em = NULL
   WHERE id = v_jid;

  -- 3. o condutor do treino entra na equipe como IMPLANTADOR, não Especialista
  PERFORM public.create_onboarding_training(
    v_jid, 'ZZ Treino', now(), v_tecnico, false, NULL, NULL, false);
  PERFORM 1 FROM public.onboarding_participants op
    JOIN public.onboarding_participant_roles r ON r.id = op.role_id
   WHERE op.ticket_id = v_ticket AND op.user_id = v_tecnico AND r.slug = 'implantador';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 3: condutor do treino não entrou como Implantador'; END IF;

  -- 4. concluir o onboarding transfere para o condutor do treino
  v_ret := public.advance_onboarding_to_implantacao(v_jid, false, true);
  IF (v_ret->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 4: advance falhou (%)', v_ret; END IF;
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_jid AND responsavel_user_id = v_tecnico;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 4b: responsabilidade não passou para o condutor do treino'; END IF;

  -- 5. o motivo gravado é exatamente o combinado
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND user_id = v_tecnico AND ate IS NULL
     AND motivo = 'Finalização da etapa do onboarding';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 5: motivo da transferência automática não confere (%)', v_qtd; END IF;

  -- 6. o período do responsável anterior foi fechado
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND user_id = v_atual AND ate IS NOT NULL;
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 6: período do responsável anterior não foi fechado'; END IF;

  -- 7. a métrica da FASE ONBOARDING guarda quem fez o onboarding, não o novo
  --    implantador (o snapshot roda antes da transferência).
  SELECT count(*) INTO v_qtd FROM public.onboarding_phase_metrics
   WHERE journey_id = v_jid AND fase = 'onboarding' AND responsavel_user_id = v_atual;
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU 7: métrica da fase onboarding não ficou com quem fez o onboarding';
  END IF;

  -- 8. o técnico não aparece duplicado na equipe
  SELECT count(*) INTO v_qtd FROM public.onboarding_participants
   WHERE ticket_id = v_ticket AND user_id = v_tecnico;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 8: técnico aparece % vezes na equipe', v_qtd; END IF;

  -- 9. o evento foi para a timeline do ticket
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_responsavel_transferido'
     AND content LIKE '%Finalização da etapa do onboarding%';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 9: evento da transferência automática não foi gravado'; END IF;

  -- 10. concluir de novo com o mesmo condutor não gera período novo (idempotente)
  UPDATE public.onboarding_journeys
     SET fase_atual = 'onboarding', current_stage_id = v_stage WHERE id = v_jid;
  PERFORM public.advance_onboarding_to_implantacao(v_jid, false, true);
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history WHERE journey_id = v_jid;
  IF v_qtd <> 2 THEN
    RAISE EXCEPTION 'FALHOU 10: esperava 2 períodos no histórico, achei % (transferência repetida)', v_qtd;
  END IF;

  -- 11. o condutor DESTA jornada entrou como Implantador.
  --     Escopo é a jornada do teste, de propósito: desde que existe o
  --     set_onboarding_participant_role, qualquer um com permissão pode mover um
  --     condutor de volta para Especialista legitimamente. "Nenhum condutor no
  --     banco inteiro é Especialista" deixou de ser invariante — era só o estado
  --     logo após o backfill.
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_participants op
    JOIN public.onboarding_participant_roles r ON r.id = op.role_id
   WHERE op.ticket_id = v_ticket AND op.user_id = v_tecnico AND r.slug = 'implantador';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 11: condutor do treino não está como Implantador nesta jornada'; END IF;

  RAISE NOTICE 'OK: 05_responsavel_na_implantacao — 11 asserções passaram';
END $$;

ROLLBACK;
