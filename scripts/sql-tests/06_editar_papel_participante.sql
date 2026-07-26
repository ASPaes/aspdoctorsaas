-- Asserções: trocar o papel de um participante, e quem tem direito de fazer isso.
BEGIN;

DO $$
DECLARE
  v_tenant     uuid;
  v_jid        uuid;
  v_ticket     uuid;
  v_resp       uuid;
  v_outro      uuid;
  v_alvo_pid   uuid;
  v_alvo_user  uuid;
  v_impl       uuid;
  v_esp        uuid;
  v_role_novo  uuid;
  v_ret        jsonb;
  v_qtd        int;
BEGIN
  SELECT j.id, j.tenant_id, j.ticket_id, j.responsavel_user_id
    INTO v_jid, v_tenant, v_ticket, v_resp
    FROM public.onboarding_journeys j
   WHERE j.responsavel_user_id IS NOT NULL
     AND (SELECT count(*) FROM public.onboarding_participants op WHERE op.ticket_id = j.ticket_id) >= 1
   LIMIT 1;
  IF v_jid IS NULL THEN RAISE EXCEPTION 'SETUP: sem jornada com responsável e participante'; END IF;

  v_impl := public.fn_onboarding_role_id(v_tenant, 'implantador');
  v_esp  := public.fn_onboarding_role_id(v_tenant, 'especialista');

  -- participante alvo: alguém que NÃO é o responsável, para os testes de troca
  SELECT op.id, op.user_id INTO v_alvo_pid, v_alvo_user
    FROM public.onboarding_participants op
   WHERE op.ticket_id = v_ticket AND op.user_id <> v_resp
   LIMIT 1;

  IF v_alvo_pid IS NULL THEN
    SELECT p.user_id INTO v_alvo_user FROM public.profiles p
     WHERE p.tenant_id = v_tenant AND p.user_id <> v_resp AND p.user_id IS NOT NULL
       AND p.access_status = 'active' LIMIT 1;
    INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
    VALUES (v_tenant, v_ticket, v_alvo_user, v_esp) RETURNING id INTO v_alvo_pid;
  END IF;

  -- garante que o alvo está num papel conhecido para a troca
  UPDATE public.onboarding_participants SET role_id = v_esp, papel = 'especialista'
   WHERE id = v_alvo_pid;

  -- ============ 1. usuário comum, que não é o responsável: NÃO pode ============
  SELECT p.user_id INTO v_outro FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL AND p.user_id <> v_resp
     AND p.access_status = 'active' AND coalesce(p.status,'ativo') = 'ativo'
     AND coalesce(p.role,'') NOT IN ('admin','head') AND coalesce(p.is_super_admin,false) = false
   LIMIT 1;

  IF v_outro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outro::text, 'role','authenticated')::text, true);
    BEGIN
      PERFORM public.set_onboarding_participant_role(v_alvo_pid, v_impl);
      RAISE EXCEPTION 'FALHOU 1: usuário comum não deveria poder trocar o papel';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHOU 1%' THEN RAISE; END IF;
    END;

    -- e nada mudou
    SELECT count(*) INTO v_qtd FROM public.onboarding_participants
     WHERE id = v_alvo_pid AND role_id = v_esp;
    IF v_qtd <> 1 THEN RAISE EXCEPTION 'FALHOU 1b: o papel mudou mesmo sem permissão'; END IF;
  END IF;

  -- ============ 2. o responsável pela jornada PODE ============
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_resp::text, 'role','authenticated')::text, true);

  v_ret := public.set_onboarding_participant_role(v_alvo_pid, v_impl);
  IF (v_ret->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU 2: retorno inesperado %', v_ret; END IF;

  PERFORM 1 FROM public.onboarding_participants WHERE id = v_alvo_pid AND role_id = v_impl;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 2b: o papel não foi trocado'; END IF;

  -- 3. a coluna legada `papel` acompanhou (invariante da suíte 02)
  PERFORM 1 FROM public.onboarding_participants
   WHERE id = v_alvo_pid AND papel = 'implantador'::public.onb_participante_papel;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 3: coluna legada papel não acompanhou a troca'; END IF;

  -- 4. o evento foi para a timeline
  SELECT count(*) INTO v_qtd FROM public.support_ticket_events
   WHERE ticket_id = v_ticket AND event_type = 'onboarding_participante'
     AND content LIKE 'Papel alterado:%';
  IF v_qtd < 1 THEN RAISE EXCEPTION 'FALHOU 4: evento de troca de papel não foi gravado'; END IF;

  -- 5. trocar para o mesmo papel é no-op, não erro
  v_ret := public.set_onboarding_participant_role(v_alvo_pid, v_impl);
  IF (v_ret->>'inalterado')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALHOU 5: trocar para o mesmo papel deveria ser no-op (%)', v_ret;
  END IF;

  -- 6. não dá para criar duas linhas da mesma pessoa em papéis diferentes
  INSERT INTO public.onboarding_participants (tenant_id, ticket_id, user_id, role_id)
  VALUES (v_tenant, v_ticket, v_alvo_user, v_esp);
  BEGIN
    PERFORM public.set_onboarding_participant_role(v_alvo_pid, v_esp);
    RAISE EXCEPTION 'FALHOU 6: deveria barrar a pessoa ocupando o mesmo papel duas vezes';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 6%' THEN RAISE; END IF;
  END;
  DELETE FROM public.onboarding_participants
   WHERE ticket_id = v_ticket AND user_id = v_alvo_user AND role_id = v_esp;

  -- 7. papel inativo não pode ser atribuído
  INSERT INTO public.onboarding_participant_roles (tenant_id, nome, cor, ativo, position)
  VALUES (v_tenant, 'ZZ Papel Inativo', '#888888', false, 99) RETURNING id INTO v_role_novo;
  BEGIN
    PERFORM public.set_onboarding_participant_role(v_alvo_pid, v_role_novo);
    RAISE EXCEPTION 'FALHOU 7: papel inativo não deveria ser atribuível';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 7%' THEN RAISE; END IF;
  END;

  -- 8. papel de OUTRO tenant é rejeitado
  SELECT r.id INTO v_role_novo FROM public.onboarding_participant_roles r
   WHERE r.tenant_id <> v_tenant LIMIT 1;
  IF v_role_novo IS NOT NULL THEN
    BEGIN
      PERFORM public.set_onboarding_participant_role(v_alvo_pid, v_role_novo);
      RAISE EXCEPTION 'FALHOU 8: papel de outro tenant deveria ser rejeitado';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALHOU 8%' THEN RAISE; END IF;
    END;
  END IF;

  -- ============ 9. admin PODE, mesmo não sendo o responsável ============
  SELECT p.user_id INTO v_outro FROM public.profiles p
   WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL AND p.user_id <> v_resp
     AND p.access_status = 'active' AND coalesce(p.status,'ativo') = 'ativo'
     AND p.role IN ('admin','head')
   LIMIT 1;
  IF v_outro IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_outro::text, 'role','authenticated')::text, true);
    v_ret := public.set_onboarding_participant_role(v_alvo_pid, v_esp);
    IF (v_ret->>'ok')::boolean IS NOT TRUE THEN
      RAISE EXCEPTION 'FALHOU 9: admin/head deveria poder trocar o papel (%)', v_ret;
    END IF;
  END IF;

  -- 10. a RPC está liberada para authenticated
  PERFORM 1 FROM information_schema.routine_privileges
   WHERE routine_schema='public' AND routine_name='set_onboarding_participant_role'
     AND grantee='authenticated';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 10: falta GRANT EXECUTE para authenticated'; END IF;

  RAISE NOTICE 'OK: 06_editar_papel_participante — 10 asserções passaram';
END $$;

ROLLBACK;
