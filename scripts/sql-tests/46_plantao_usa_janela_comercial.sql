-- fn_atendimento_plantao_em tem que medir contra a janela COMERCIAL, não contra a
-- de disponibilidade. Cenário: o Suporte da Digi Office atende até 22h (janela de
-- disponibilidade), mas o comercial fecha 18h — trabalho às 19h é plantão.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/46_plantao_usa_janela_comercial.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_ini    timestamptz := '2026-08-24 14:00-03';  -- segunda
  v_res    timestamptz;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.configuracoes LIMIT 1;

  UPDATE public.configuracoes SET
    business_hours_timezone   = 'America/Sao_Paulo',
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','22:00')))),
    horario_comercial_enabled = true,
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- 19:00: dentro da disponibilidade, FORA do comercial => plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 23:00-03'::timestamptz,
    NULL, '2026-08-24 19:00-03'::timestamptz);
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'FALHOU: 19:00 deveria ser plantão pela janela comercial';
  END IF;

  -- 15:00: dentro dos dois => não é plantão.
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 23:00-03'::timestamptz,
    NULL, '2026-08-24 15:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: 15:00 não é plantão, veio %', v_res;
  END IF;

  -- Carimbo FORA da janela do atendimento é ignorado (há 107 atendimentos em prod
  -- com first_human_response_at posterior ao fechamento).
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 16:00-03'::timestamptz,
    NULL, '2026-08-24 19:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU: carimbo depois do fechamento não podia contar';
  END IF;

  -- Tenant sem janela comercial cadastrada: volta a medir pela disponibilidade,
  -- então 19:00 (dentro de 09-22) deixa de ser plantão.
  UPDATE public.configuracoes SET horario_comercial_enabled = false WHERE tenant_id = v_tenant;
  v_res := public.fn_atendimento_plantao_em(
    v_tenant, NULL, NULL, v_ini, '2026-08-24 23:00-03'::timestamptz,
    NULL, '2026-08-24 19:00-03'::timestamptz);
  IF v_res IS NOT NULL THEN
    RAISE EXCEPTION 'FALHOU fallback: sem cadastro, 19:00 dentro de 09-22 não é plantão';
  END IF;

  RAISE NOTICE 'OK: task 4';
END $$;

ROLLBACK;
