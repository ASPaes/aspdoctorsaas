-- Janela comercial: cadastro e leitura.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/45_janela_comercial.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_col    int;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'FIXTURE: nenhuma linha em configuracoes'; END IF;

  -- 1. as colunas existem, com os tipos certos
  SELECT count(*) INTO v_col
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='configuracoes'
    AND ((column_name='horario_comercial' AND data_type='jsonb')
      OR (column_name='horario_comercial_enabled' AND data_type='boolean'));
  IF v_col <> 2 THEN
    RAISE EXCEPTION 'FALHOU: esperava 2 colunas novas, achei %', v_col;
  END IF;

  -- 2. o default é false: tenant que não cadastrou não muda de comportamento
  IF EXISTS (SELECT 1 FROM public.configuracoes WHERE horario_comercial_enabled IS NULL) THEN
    RAISE EXCEPTION 'FALHOU: horario_comercial_enabled aceitou NULL';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name='configuracoes'
        AND column_name='horario_comercial_enabled') NOT LIKE 'false%' THEN
    RAISE EXCEPTION 'FALHOU: default de horario_comercial_enabled não é false';
  END IF;

  RAISE NOTICE 'OK: task 1';
END $$;

ROLLBACK;
