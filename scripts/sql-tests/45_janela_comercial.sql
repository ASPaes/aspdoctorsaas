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

DO $$
DECLARE
  v_tenant uuid;
  v_abre   time;
  v_fecha  time;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    horario_comercial_enabled = true,
    business_hours_timezone   = 'America/Sao_Paulo',
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(
               jsonb_build_object('start','08:00','end','12:00'),
               jsonb_build_object('start','13:30','end','18:18'))),
      'tue', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'wed', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'thu', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'fri', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','17:00'))),
      'sat', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))),
      'sun', jsonb_build_object('active', false, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- Segunda com almoço: a janela do DIA vai da primeira borda à última.
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-24 15:00-03'::timestamptz);
  IF v_abre <> '08:00' OR v_fecha <> '18:18' THEN
    RAISE EXCEPTION 'FALHOU segunda: esperava 08:00-18:18, veio %-%', v_abre, v_fecha;
  END IF;

  -- Sexta fecha mais cedo.
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-28 15:00-03'::timestamptz);
  IF v_fecha <> '17:00' THEN
    RAISE EXCEPTION 'FALHOU sexta: esperava fechar 17:00, veio %', v_fecha;
  END IF;

  -- Sábado inativo => sem janela (tudo que acontecer nele é plantão).
  SELECT abre, fecha INTO v_abre, v_fecha
  FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-29 15:00-03'::timestamptz);
  IF v_abre IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU sabado: esperava janela nula, veio %', v_abre;
  END IF;

  -- Desligado => cai na janela de disponibilidade, idêntico ao comportamento atual.
  UPDATE public.configuracoes SET horario_comercial_enabled = false WHERE tenant_id = v_tenant;
  IF (SELECT abre FROM public.fn_janela_comercial_do_dia(v_tenant, '2026-08-24 15:00-03'::timestamptz))
     IS DISTINCT FROM
     (SELECT abre FROM public.fn_expediente_janela_do_dia(v_tenant, NULL, '2026-08-24 15:00-03'::timestamptz))
  THEN
    RAISE EXCEPTION 'FALHOU fallback: desligado deveria devolver a janela de disponibilidade';
  END IF;

  RAISE NOTICE 'OK: task 2';
END $$;

ROLLBACK;
