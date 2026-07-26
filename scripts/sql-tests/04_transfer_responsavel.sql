-- Asserções da Task 6: comportamento da RPC de transferência.
--
-- IMPORTANTE: a RPC chama can_access_tenant_row(), que depende de auth.uid().
-- Rodando por psql não existe JWT, auth.uid() é NULL e TODA chamada seria
-- rejeitada com "Sem permissão". Por isso o teste simula o JWT de um membro
-- ativo do tenant com set_config('request.jwt.claims', ..., is_local => true),
-- que vale até o ROLLBACK.
BEGIN;

DO $$
DECLARE
  v_jid       uuid;
  v_tenant    uuid;
  v_atual     uuid;
  v_novo      uuid;
  v_caller    uuid;
  v_terceiro  uuid;
  v_ticket    uuid;
  v_ret       jsonb;
  v_qtd       int;
  v_antes     int;
  v_impl      uuid;
BEGIN
  -- cenário: uma jornada com responsável e outro usuário do mesmo tenant
  SELECT j.id, j.tenant_id, j.responsavel_user_id
    INTO v_jid, v_tenant, v_atual
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NOT NULL
   LIMIT 1;
  IF v_jid IS NULL THEN RAISE EXCEPTION 'SETUP: nenhuma jornada com responsável no banco local'; END IF;

  -- v_novo precisa estar FORA da lista de participantes: a asserção 7 valida
  -- justamente o caso "não é participante ainda -> entra como implantador".
  SELECT j.ticket_id INTO v_ticket FROM public.onboarding_journeys j WHERE j.id = v_jid;

  SELECT p.user_id INTO v_novo
    FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id <> v_atual AND p.user_id IS NOT NULL
     AND p.access_status = 'active' AND coalesce(p.status, 'ativo') = 'ativo'
     AND p.user_id NOT IN (
       SELECT op.user_id FROM public.onboarding_participants op WHERE op.ticket_id = v_ticket
     )
   LIMIT 1;
  IF v_novo IS NULL THEN RAISE EXCEPTION 'SETUP: tenant sem usuário ativo fora da equipe para receber a transferência'; END IF;

  -- simula o JWT de um membro ativo do tenant (exigência de can_access_tenant_row)
  SELECT p.user_id INTO v_caller
    FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL
     AND p.access_status = 'active' AND coalesce(p.status, 'ativo') = 'ativo'
   LIMIT 1;
  IF v_caller IS NULL THEN RAISE EXCEPTION 'SETUP: tenant sem membro ativo para simular o chamador'; END IF;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_caller::text, 'role', 'authenticated')::text,
    true
  );

  IF auth.uid() IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'SETUP: simulação de JWT não pegou (auth.uid() = %)', auth.uid();
  END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN
    RAISE EXCEPTION 'SETUP: chamador simulado não passa em can_access_tenant_row';
  END IF;

  -- 1. motivo vazio é rejeitado
  BEGIN
    PERFORM public.transfer_onboarding_responsavel(v_jid, v_novo, '   ');
    RAISE EXCEPTION 'FALHOU 1: motivo vazio deveria ser rejeitado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 1%' THEN RAISE; END IF;
  END;

  -- 2. transferir para quem já é responsável é rejeitado
  BEGIN
    PERFORM public.transfer_onboarding_responsavel(v_jid, v_atual, 'motivo qualquer');
    RAISE EXCEPTION 'FALHOU 2: transferir para o próprio responsável deveria ser rejeitado';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 2%' THEN RAISE; END IF;
  END;

  -- 3. transferência válida devolve ok
  v_ret := public.transfer_onboarding_responsavel(v_jid, v_novo, 'Férias do implantador');
  IF (v_ret->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 3: retorno inesperado %', v_ret; END IF;
  IF (v_ret->>'responsavel_user_id')::uuid <> v_novo THEN RAISE EXCEPTION 'FALHOU 3b: retorno com responsável errado'; END IF;

  -- 4. a jornada aponta para o novo responsável
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_jid AND responsavel_user_id = v_novo;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 4: jornada não atualizou responsavel_user_id'; END IF;

  -- 5. o período anterior foi fechado
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND user_id = v_atual AND ate IS NOT NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 5: esperava 1 período fechado do antigo, achei %', v_qtd; END IF;

  -- 6. existe exatamente 1 período aberto, do novo, com o motivo gravado
  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NULL AND user_id = v_novo AND motivo = 'Férias do implantador';
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 6: período aberto do novo responsável não confere (%)' , v_qtd; END IF;

  -- 7. quem NÃO era participante entra como implantador
  v_impl := public.fn_onboarding_role_id(v_tenant, 'implantador');
  PERFORM 1 FROM public.onboarding_participants op
    JOIN public.onboarding_journeys j ON j.ticket_id = op.ticket_id
   WHERE j.id = v_jid AND op.user_id = v_novo AND op.role_id = v_impl;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: novo responsável não entrou como participante implantador'; END IF;

  -- 8. o antigo CONTINUA como participante (decisão D5 do spec)
  PERFORM 1 FROM public.onboarding_participants op
    JOIN public.onboarding_journeys j ON j.ticket_id = op.ticket_id
   WHERE j.id = v_jid AND op.user_id = v_atual;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8: o responsável antigo foi removido da equipe indevidamente'; END IF;

  -- 9. evento registrado na timeline do ticket
  SELECT count(*) INTO v_qtd
    FROM public.support_ticket_events e
    JOIN public.onboarding_journeys j ON j.ticket_id = e.ticket_id
   WHERE j.id = v_jid AND e.event_type = 'onboarding_responsavel_transferido';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 9: evento de transferência não foi gravado'; END IF;

  -- 10. a view reflete o novo responsável
  PERFORM 1 FROM public.vw_onboarding_journeys
   WHERE journey_id = v_jid AND responsavel_user_id = v_novo;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 10: a view não reflete o novo responsável'; END IF;

  -- 11. segunda transferência mantém a cadeia consistente.
  --     Conta o DELTA, não o total: a jornada é real e já pode ter histórico de
  --     transferências anteriores. Contar o absoluto fazia o teste falhar por
  --     dado acumulado, não por regressão.
  SELECT count(*) INTO v_antes FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NOT NULL;
  PERFORM public.transfer_onboarding_responsavel(v_jid, v_atual, 'Volta do titular');

  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NULL;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 11a: esperava 1 período aberto, achei %', v_qtd; END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_responsavel_history
   WHERE journey_id = v_jid AND ate IS NOT NULL;
  IF v_qtd <> v_antes + 1 THEN
    RAISE EXCEPTION 'FALHOU 11b: a transferência deveria fechar exatamente 1 período (antes %, depois %)', v_antes, v_qtd;
  END IF;

  -- 12. usuário de outro tenant é rejeitado
  SELECT p.user_id INTO v_novo FROM public.profiles p
   WHERE p.tenant_id <> v_tenant AND p.user_id IS NOT NULL LIMIT 1;
  IF v_novo IS NOT NULL THEN
    BEGIN
      PERFORM public.transfer_onboarding_responsavel(v_jid, v_novo, 'teste cross-tenant');
      RAISE EXCEPTION 'FALHOU 12: usuário de outro tenant deveria ser rejeitado';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHOU 12%' THEN RAISE; END IF;
    END;
  END IF;

  -- 13. a RPC está liberada para `authenticated`
  PERFORM 1 FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='transfer_onboarding_responsavel' AND grantee='authenticated';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 13: falta GRANT EXECUTE para authenticated'; END IF;

  -- 14. fn_snapshot_onboarding_phase não deriva mais o responsável de participantes
  PERFORM 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='fn_snapshot_onboarding_phase'
     AND pg_get_functiondef(p.oid) LIKE '%onboarding_participants%';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 14: fn_snapshot_onboarding_phase ainda lê onboarding_participants'; END IF;

  -- 15. quem JÁ é participante em outro papel NÃO ganha linha nova.
  --     Regra do owner: transferir só move a responsabilidade; a pessoa não
  --     pode aparecer duas vezes na lista (ex: Renan como Especialista viraria
  --     também Implantador).
  SELECT j.ticket_id INTO v_ticket FROM public.onboarding_journeys j WHERE j.id = v_jid;
  SELECT p.user_id INTO v_terceiro
    FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL
     AND p.access_status = 'active' AND coalesce(p.status, 'ativo') = 'ativo'
     AND p.user_id NOT IN (
       SELECT op.user_id FROM public.onboarding_participants op WHERE op.ticket_id = v_ticket
     )
   LIMIT 1;
  IF v_terceiro IS NULL THEN RAISE EXCEPTION 'SETUP 15: sem usuário livre para o cenário'; END IF;

  -- entra como Especialista (papel diferente de implantador)
  INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
  VALUES (v_tenant, v_ticket, v_terceiro, public.fn_onboarding_role_id(v_tenant, 'especialista'));

  SELECT count(*) INTO v_antes FROM public.onboarding_participants WHERE ticket_id = v_ticket;
  PERFORM public.transfer_onboarding_responsavel(v_jid, v_terceiro, 'Assume quem já estava no time');
  SELECT count(*) INTO v_qtd FROM public.onboarding_participants WHERE ticket_id = v_ticket;
  IF v_qtd <> v_antes THEN
    RAISE EXCEPTION 'FALHOU 15a: transferência criou % linha(s) de participante para quem já estava na lista', v_qtd - v_antes;
  END IF;

  SELECT count(*) INTO v_qtd FROM public.onboarding_participants
   WHERE ticket_id = v_ticket AND user_id = v_terceiro;
  IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 15b: o novo responsável aparece % vezes na lista', v_qtd; END IF;

  -- e continua no papel original, sem virar implantador
  PERFORM 1 FROM public.onboarding_participants
   WHERE ticket_id = v_ticket AND user_id = v_terceiro
     AND role_id = public.fn_onboarding_role_id(v_tenant, 'especialista');
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 15c: o papel original do participante foi trocado'; END IF;

  -- mas a responsabilidade mudou de fato
  PERFORM 1 FROM public.onboarding_journeys WHERE id = v_jid AND responsavel_user_id = v_terceiro;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 15d: a responsabilidade não foi transferida'; END IF;

  RAISE NOTICE 'OK: 04_transfer_responsavel — 15 asserções passaram';
END $$;

ROLLBACK;
