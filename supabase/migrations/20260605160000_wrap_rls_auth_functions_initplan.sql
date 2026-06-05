-- ============================================================================
-- Migration: wrap_rls_auth_functions_initplan
-- Data: 2026-06-05
--
-- OBJETIVO
--   Corrigir performance de RLS em todo o schema public. As policies chamavam
--   funções de autorização (is_super_admin, current_tenant_id,
--   is_tenant_active_member, is_admin_or_head, is_tenant_admin,
--   current_user_department_id, auth.uid) e can_access_tenant_row() de forma
--   "crua", fazendo o Postgres reavaliá-las POR LINHA. Em views security_invoker
--   com LATERAL JOINs (ex.: vw_clientes_financeiro) isso multiplicava o custo:
--   13.5s por consulta no tenant Digioffice (1356 clientes), estourando o
--   statement_timeout=8s do role authenticated e zerando o Dashboard.
--
--   O fix é o padrão oficial Supabase: envolver as chamadas em (SELECT fn()),
--   forçando avaliação única via InitPlan. can_access_tenant_row(<col>) é
--   DECOMPOSTA em sua definição equivalente para também virar InitPlan
--   (o wrap simples (SELECT can_access_tenant_row(col)) viraria SubPlan
--   correlacionada e NÃO resolveria — medido: 3.4s vs 12ms).
--
--   Resultado medido após o fix: 13.482ms -> ~24ms (redução ~560x).
--   Semântica de acesso INALTERADA: apenas muda QUANDO a função é avaliada.
--
-- IDEMPOTÊNCIA
--   Só reescreve policies que ainda contêm o padrão "cru" (negative lookbehind
--   para "SELECT "). Rodar em banco já corrigido é no-op seguro.
-- ============================================================================

DO $migration$
DECLARE
  rec record;
  v_new_qual text;
  v_new_check text;
  v_sql text;
  v_pass int;
  v_pending int;
  v_applied int := 0;
BEGIN
  -- Função local de transformação (mesma lógica validada em produção)
  CREATE OR REPLACE FUNCTION pg_temp.wrap_rls(expr text)
  RETURNS text LANGUAGE plpgsql AS $f$
  DECLARE r text := expr;
  BEGIN
    IF r IS NULL THEN RETURN NULL; END IF;

    -- can_access_tenant_row(<col>) -> decomposição (preserva tenant_id ou id)
    r := regexp_replace(
      r,
      'can_access_tenant_row\(([a-z_]+)\)',
      '((SELECT public.is_super_admin()) OR ((SELECT public.is_tenant_active_member()) AND \1 = (SELECT public.current_tenant_id())))',
      'g'
    );

    -- funções sem-arg cruas -> wrap (SELECT public.fn())
    r := regexp_replace(r, '(?<!SELECT )(?<!SELECT public\.)is_super_admin\(\)',          '(SELECT public.is_super_admin())', 'g');
    r := regexp_replace(r, '(?<!SELECT )(?<!SELECT public\.)is_tenant_active_member\(\)',  '(SELECT public.is_tenant_active_member())', 'g');
    r := regexp_replace(r, '(?<!SELECT )(?<!SELECT public\.)is_admin_or_head\(\)',         '(SELECT public.is_admin_or_head())', 'g');
    r := regexp_replace(r, '(?<!SELECT )(?<!SELECT public\.)is_tenant_admin\(\)',          '(SELECT public.is_tenant_admin())', 'g');
    r := regexp_replace(r, '(?<!SELECT )(?<!SELECT public\.)current_user_department_id\(\)','(SELECT public.current_user_department_id())', 'g');
    r := regexp_replace(r, '(?<!SELECT )(?<!SELECT public\.)current_tenant_id\(\)',        '(SELECT public.current_tenant_id())', 'g');

    -- auth.uid() cru -> (SELECT auth.uid())
    r := regexp_replace(r, '(?<!SELECT )auth\.uid\(\)', '(SELECT auth.uid())', 'g');

    RETURN r;
  END $f$;

  -- lock_timeout curto: evita travar tabelas quentes durante o ALTER
  SET LOCAL lock_timeout = '3s';

  -- até 6 passadas, reprocessando o que falhar por contenção de lock
  FOR v_pass IN 1..6 LOOP
    v_pending := 0;

    FOR rec IN
      SELECT tablename, policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
    LOOP
      v_new_qual  := pg_temp.wrap_rls(rec.qual);
      v_new_check := pg_temp.wrap_rls(rec.with_check);

      IF (rec.qual IS DISTINCT FROM v_new_qual)
         OR (rec.with_check IS DISTINCT FROM v_new_check) THEN

        v_sql := format('ALTER POLICY %I ON public.%I', rec.policyname, rec.tablename);
        IF v_new_qual IS NOT NULL THEN
          v_sql := v_sql || format(' USING (%s)', v_new_qual);
        END IF;
        IF v_new_check IS NOT NULL THEN
          v_sql := v_sql || format(' WITH CHECK (%s)', v_new_check);
        END IF;

        BEGIN
          EXECUTE v_sql;
          v_applied := v_applied + 1;
        EXCEPTION
          WHEN lock_not_available OR deadlock_detected THEN
            v_pending := v_pending + 1;  -- tenta na próxima passada
        END;
      END IF;
    END LOOP;

    EXIT WHEN v_pending = 0;
    PERFORM pg_sleep(2);
  END LOOP;

  RAISE NOTICE 'wrap_rls: % policies ajustadas, % pendentes apos retries', v_applied, v_pending;
END $migration$;
