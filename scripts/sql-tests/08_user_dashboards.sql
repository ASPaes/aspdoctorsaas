-- Asserções da tabela user_dashboards (Meu Painel): unicidade e RLS.
-- Usa os dados reais do banco local + JWT forjado; tudo dentro de
-- BEGIN/ROLLBACK, sem deixar rastro. Assere INVARIANTES, nunca contagens
-- absolutas da base.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/08_user_dashboards.sql
BEGIN;

DO $$
DECLARE
  v_tenant  uuid;
  v_user_a  uuid;
  v_user_b  uuid;
  v_qtd     int;
BEGIN
  -- O tenant vem PRIMEIRO, e só serve o que tem dois usuários comuns. Pegar
  -- um profile qualquer e usar o tenant dele não funciona: a maioria dos
  -- tenants da base tem um usuário só.
  SELECT p.tenant_id INTO v_tenant
    FROM public.profiles p
    WHERE p.tenant_id IS NOT NULL AND p.user_id IS NOT NULL
      AND COALESCE(p.is_super_admin, false) = false
    GROUP BY p.tenant_id
    HAVING count(*) > 1
    LIMIT 1;

  SELECT p.user_id INTO v_user_a
    FROM public.profiles p
    WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL
      AND COALESCE(p.is_super_admin, false) = false
    ORDER BY p.user_id
    LIMIT 1;

  SELECT p.user_id INTO v_user_b
    FROM public.profiles p
    WHERE p.tenant_id = v_tenant AND p.user_id IS NOT NULL AND p.user_id <> v_user_a
      AND COALESCE(p.is_super_admin, false) = false
    ORDER BY p.user_id
    LIMIT 1;

  IF v_user_a IS NULL OR v_user_b IS NULL THEN
    RAISE EXCEPTION 'FIXTURE: preciso de dois profiles nao-super-admin no mesmo tenant';
  END IF;

  INSERT INTO public.user_dashboards (tenant_id, user_id, layout)
    VALUES (v_tenant, v_user_a, '{"versao":1,"secoes":[]}'::jsonb);
  INSERT INTO public.user_dashboards (tenant_id, user_id, layout)
    VALUES (v_tenant, v_user_b, '{"versao":1,"secoes":[]}'::jsonb);

  -- 1. Unicidade: o mesmo usuário não pode ter dois painéis no mesmo tenant.
  BEGIN
    INSERT INTO public.user_dashboards (tenant_id, user_id)
      VALUES (v_tenant, v_user_a);
    RAISE EXCEPTION 'FALHOU: unicidade (tenant_id, user_id) nao barrou o segundo painel';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user_a, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;

  -- 2. RLS na leitura: o usuário A enxerga exatamente um painel, o dele.
  SELECT count(*) INTO v_qtd FROM public.user_dashboards;
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU: usuario A enxergou % paineis, esperado 1', v_qtd;
  END IF;

  SELECT count(*) INTO v_qtd FROM public.user_dashboards WHERE user_id = v_user_b;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU: usuario A enxergou o painel do usuario B';
  END IF;

  -- 3. RLS na escrita: escrever no painel alheio não afeta nenhuma linha.
  UPDATE public.user_dashboards
    SET layout = '{"versao":1,"secoes":[{"id":"invasao"}]}'::jsonb
    WHERE user_id = v_user_b;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU: usuario A escreveu no painel do usuario B';
  END IF;

  -- 4. RLS no delete: apagar o painel alheio também não afeta nada.
  DELETE FROM public.user_dashboards WHERE user_id = v_user_b;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 0 THEN
    RAISE EXCEPTION 'FALHOU: usuario A apagou o painel do usuario B';
  END IF;

  -- 5. O usuário escreve no PRÓPRIO painel normalmente.
  UPDATE public.user_dashboards
    SET layout = '{"versao":1,"secoes":[{"id":"s1","nome":"Suporte","area":"atendimento","filtros":{},"itens":[]}]}'::jsonb
    WHERE user_id = v_user_a;
  GET DIAGNOSTICS v_qtd = ROW_COUNT;
  IF v_qtd <> 1 THEN
    RAISE EXCEPTION 'FALHOU: usuario A nao conseguiu escrever no proprio painel';
  END IF;

  RESET role;
  RAISE EXCEPTION 'SMOKE_OK| unicidade, RLS de leitura, escrita e delete conferidas';
END $$;

ROLLBACK;
