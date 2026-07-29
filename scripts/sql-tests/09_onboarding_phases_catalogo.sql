-- Asserções da Task 1 (Entrega A): catálogo de jornadas por tenant.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/09_onboarding_phases_catalogo.sql
BEGIN;

DO $$
DECLARE
  v_novo uuid;
  v_qtd  int;
  v_id   uuid;
BEGIN
  -- 1. tabela existe com as 9 colunas esperadas
  SELECT count(*) INTO v_qtd FROM information_schema.columns
   WHERE table_schema='public' AND table_name='onboarding_phases'
     AND column_name IN ('id','tenant_id','nome','slug','cor','ativo','position','created_at','updated_at');
  IF v_qtd <> 9 THEN RAISE EXCEPTION 'FALHOU 1: onboarding_phases tem % das 9 colunas esperadas', v_qtd; END IF;

  -- 2. RLS ligada com 4 policies TO authenticated
  SELECT count(*) INTO v_qtd FROM pg_policies
   WHERE schemaname='public' AND tablename='onboarding_phases' AND roles::text='{authenticated}';
  IF v_qtd <> 4 THEN RAISE EXCEPTION 'FALHOU 2: esperava 4 policies TO authenticated, achei %', v_qtd; END IF;

  -- 3. todo tenant existente recebeu as 3 fases-semente
  SELECT count(*) INTO v_qtd FROM public.tenants t
   WHERE (SELECT count(*) FROM public.onboarding_phases f WHERE f.tenant_id=t.id AND f.slug IS NOT NULL) <> 3;
  IF v_qtd <> 0 THEN RAISE EXCEPTION 'FALHOU 3: % tenant(s) sem as 3 fases-semente', v_qtd; END IF;

  -- 4. tenant novo recebe as fases pelo trigger, e acompanhamento nasce desligada
  INSERT INTO public.tenants (nome) VALUES ('ZZ Teste Seed Fases') RETURNING id INTO v_novo;
  SELECT count(*) INTO v_qtd FROM public.onboarding_phases WHERE tenant_id=v_novo;
  IF v_qtd <> 3 THEN RAISE EXCEPTION 'FALHOU 4a: tenant novo recebeu % fases, esperava 3', v_qtd; END IF;
  PERFORM 1 FROM public.onboarding_phases WHERE tenant_id=v_novo AND slug='acompanhamento' AND ativo=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 4b: acompanhamento deveria nascer inativa'; END IF;

  -- 5. resolvedor de slug funciona
  SELECT public.fn_onboarding_phase_id(v_novo, 'implantacao') INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'FALHOU 5: fn_onboarding_phase_id não resolveu implantacao'; END IF;

  -- 6. fase-semente não pode ser excluída
  BEGIN
    DELETE FROM public.onboarding_phases WHERE tenant_id=v_novo AND slug='onboarding';
    RAISE EXCEPTION 'FALHOU 6: DELETE de fase-semente deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 7. slug é imutável
  BEGIN
    UPDATE public.onboarding_phases SET slug='outra_coisa' WHERE tenant_id=v_novo AND slug='onboarding';
    RAISE EXCEPTION 'FALHOU 7: alterar slug deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 8. fase-semente PODE ser renomeada (é o caso "cada tenant chama do seu jeito")
  UPDATE public.onboarding_phases SET nome='Implantação Técnica', cor='#FF00FF'
   WHERE tenant_id=v_novo AND slug='implantacao';
  PERFORM 1 FROM public.onboarding_phases
   WHERE tenant_id=v_novo AND slug='implantacao' AND nome='Implantação Técnica';
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 8: renomear fase-semente não funcionou'; END IF;

  -- 9. fase-semente PODE ser desativada (jornada única)
  UPDATE public.onboarding_phases SET ativo=false WHERE tenant_id=v_novo AND slug='implantacao';
  PERFORM 1 FROM public.onboarding_phases WHERE tenant_id=v_novo AND slug='implantacao' AND ativo=false;
  IF NOT FOUND THEN RAISE EXCEPTION 'FALHOU 9: desativar fase-semente deveria funcionar'; END IF;

  -- 10. mas não dá para zerar: a última fase ativa não pode ser desligada
  BEGIN
    UPDATE public.onboarding_phases SET ativo=false WHERE tenant_id=v_novo AND slug='onboarding';
    RAISE EXCEPTION 'FALHOU 10: desativar a última fase ativa deveria ter sido bloqueado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 11. fase criada pelo tenant (slug NULL) pode ser desativada e excluída
  INSERT INTO public.onboarding_phases (tenant_id, nome, position) VALUES (v_novo, 'Pós-venda', 9);
  UPDATE public.onboarding_phases SET ativo=false WHERE tenant_id=v_novo AND nome='Pós-venda';
  DELETE FROM public.onboarding_phases WHERE tenant_id=v_novo AND nome='Pós-venda';

  -- 12. nome duplicado no mesmo tenant é rejeitado (case-insensitive)
  BEGIN
    INSERT INTO public.onboarding_phases (tenant_id, nome) VALUES (v_novo, 'onboarding');
    RAISE EXCEPTION 'FALHOU 12: nome duplicado deveria violar a unique';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: 09_onboarding_phases_catalogo — 12 asserções passaram';
END $$;

ROLLBACK;
