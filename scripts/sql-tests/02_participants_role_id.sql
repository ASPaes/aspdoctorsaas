-- Asserções da Task 2: onboarding_participants.role_id + RPCs resolvendo papel por slug.
BEGIN;

DO $$
DECLARE
  v_qtd    int;
  v_tenant uuid;
  v_role   uuid;
BEGIN
  -- 1. coluna role_id existe e é NOT NULL
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_participants'
     AND column_name='role_id' AND is_nullable='NO';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 1: role_id ausente ou nullable'; END IF;

  -- 2. nenhum participante ficou sem role_id
  SELECT count(*) INTO v_qtd FROM public.onboarding_participants WHERE role_id IS NULL;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 2: % participante(s) sem role_id', v_qtd; END IF;

  -- 3. a coluna legada `papel` nunca contradiz o role_id.
  --    Ela só existe para rollback até ser dropada; se ficar mentindo, o
  --    rollback restauraria papéis errados. NULL é válido (papel criado pelo
  --    tenant não tem correspondente no enum).
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_participants op
    JOIN public.onboarding_participant_roles r ON r.id = op.role_id
   WHERE op.papel IS NOT NULL AND r.slug IS DISTINCT FROM op.papel::text;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % linha(s) com papel legado contradizendo o role_id', v_qtd; END IF;

  -- 3b. e o DEFAULT precisa ter caído, senão linha nova nasce mentindo
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_participants'
     AND column_name='papel' AND column_default IS NOT NULL;
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 3b: coluna legada papel ainda tem DEFAULT'; END IF;

  -- 4. role_id sempre aponta para papel do mesmo tenant
  SELECT count(*) INTO v_qtd
    FROM public.onboarding_participants op
    JOIN public.onboarding_participant_roles r ON r.id = op.role_id
   WHERE r.tenant_id <> op.tenant_id;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 4: % linha(s) com papel de outro tenant', v_qtd; END IF;

  -- 5. constraint nova existe e a antiga sumiu
  PERFORM 1 FROM pg_constraint
   WHERE conrelid='public.onboarding_participants'::regclass
     AND conname='onboarding_participants_ticket_user_role_key';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 5a: unique (ticket_id,user_id,role_id) não existe'; END IF;
  PERFORM 1 FROM pg_constraint
   WHERE conrelid='public.onboarding_participants'::regclass
     AND conname='onboarding_participants_ticket_id_user_id_papel_key';
  IF FOUND THEN RAISE EXCEPTION 'FALHOU 5b: unique antiga por papel ainda existe'; END IF;

  -- 6. fn_onboarding_role_id resolve por slug
  SELECT id INTO v_tenant FROM public.tenants ORDER BY created_at LIMIT 1;
  v_role := public.fn_onboarding_role_id(v_tenant, 'implantador');
  IF v_role IS NULL THEN RAISE EXCEPTION 'FALHOU 6: fn_onboarding_role_id devolveu NULL'; END IF;

  -- 7. continua resolvendo depois de o tenant renomear o papel
  UPDATE public.onboarding_participant_roles SET nome = 'Analista de Implantação'
   WHERE tenant_id = v_tenant AND slug = 'implantador';
  IF public.fn_onboarding_role_id(v_tenant, 'implantador') <> v_role THEN
    RAISE EXCEPTION 'FALHOU 7: renomear o papel quebrou a resolução por slug';
  END IF;

  -- 8. slug inexistente estoura erro claro
  BEGIN
    PERFORM public.fn_onboarding_role_id(v_tenant, 'nao_existe');
    RAISE EXCEPTION 'FALHOU 8: slug inexistente deveria estourar';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FALHOU 8%' THEN RAISE; END IF;
  END;

  -- 9. as 3 RPCs não referenciam mais o enum ao inserir participante
  SELECT count(*) INTO v_qtd
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public'
     AND p.proname IN ('create_onboarding_journey','return_to_vendor','create_onboarding_training')
     AND pg_get_functiondef(p.oid) LIKE '%onboarding_participants (tenant_id, ticket_id, user_id, papel)%';
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 9: % RPC(s) ainda inserem participante pelo enum', v_qtd; END IF;

  RAISE NOTICE 'OK: 02_participants_role_id — 9 asserções passaram';
END $$;

ROLLBACK;
