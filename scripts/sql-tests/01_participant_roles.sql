-- Asserções da Task 1: tabela de papéis de participante do onboarding.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/01_participant_roles.sql
BEGIN;

DO $$
DECLARE
  v_novo   uuid;
  v_qtd    int;
BEGIN
  -- 1. tabela existe com as colunas certas
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_participant_roles'
     AND column_name IN ('id','tenant_id','nome','slug','cor','ativo','position','created_at','updated_at');
  IF v_qtd <> 9 THEN RAISE EXCEPTION 'FALHOU 1: onboarding_participant_roles tem % das 9 colunas esperadas', v_qtd; END IF;

  -- 2. RLS ligada com as 4 policies
  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_participant_roles';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 2: esperava 4 policies, achei %', v_qtd; END IF;

  -- 3. todo tenant existente recebeu os 4 papéis-semente
  SELECT count(*) INTO v_qtd
    FROM public.tenants t
   WHERE (SELECT count(*) FROM public.onboarding_participant_roles r
           WHERE r.tenant_id = t.id AND r.slug IS NOT NULL) <> 4;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % tenant(s) sem os 4 papéis-semente', v_qtd; END IF;

  -- 4. tenant novo recebe os papéis pelo trigger
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Seed Papeis') RETURNING id INTO v_novo;
  SELECT count(*) INTO v_qtd FROM public.onboarding_participant_roles WHERE tenant_id = v_novo;
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 4: tenant novo recebeu % papéis, esperava 4', v_qtd; END IF;

  -- 5. papel-semente não pode ser excluído
  BEGIN
    DELETE FROM public.onboarding_participant_roles WHERE tenant_id = v_novo AND slug = 'implantador';
    RAISE EXCEPTION 'FALHOU 5: DELETE de papel-semente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 6. papel-semente não pode ser desativado
  BEGIN
    UPDATE public.onboarding_participant_roles SET ativo = false WHERE tenant_id = v_novo AND slug = 'vendedor';
    RAISE EXCEPTION 'FALHOU 6: desativar papel-semente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 7. papel-semente PODE ser renomeado e recolorido
  UPDATE public.onboarding_participant_roles
     SET nome = 'Consultor Comercial', cor = '#FF00FF'
   WHERE tenant_id = v_novo AND slug = 'vendedor';
  PERFORM 1 FROM public.onboarding_participant_roles
   WHERE tenant_id = v_novo AND slug = 'vendedor' AND nome = 'Consultor Comercial';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 7: renomear papel-semente não funcionou'; END IF;

  -- 8. slug é imutável
  BEGIN
    UPDATE public.onboarding_participant_roles SET slug = 'outro_qualquer'
     WHERE tenant_id = v_novo AND slug = 'vendedor';
    RAISE EXCEPTION 'FALHOU 8: alterar slug deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 9. papel criado pelo tenant (slug NULL) pode ser desativado e excluído
  INSERT INTO public.onboarding_participant_roles (tenant_id, nome, cor, position)
  VALUES (v_novo, 'Financeiro', '#F59E0B', 9);
  UPDATE public.onboarding_participant_roles SET ativo = false WHERE tenant_id = v_novo AND nome = 'Financeiro';
  DELETE FROM public.onboarding_participant_roles WHERE tenant_id = v_novo AND nome = 'Financeiro';

  -- 10. nome duplicado no mesmo tenant é rejeitado (case-insensitive)
  BEGIN
    INSERT INTO public.onboarding_participant_roles (tenant_id, nome) VALUES (v_novo, 'implantador');
    RAISE EXCEPTION 'FALHOU 10: nome duplicado deveria violar a unique';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: 01_participant_roles — 10 asserções passaram';
END $$;

ROLLBACK;
