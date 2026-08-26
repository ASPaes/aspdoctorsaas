-- check_tipo_horario é o que o modal de ticket chama no modo "auto".
-- Tem que responder pela mesma régua do chat, senão ticket e chat divergem.
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f - < scripts/sql-tests/47_check_tipo_horario.sql
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_uid    uuid;
  v_r      text;
BEGIN
  -- Precisa de um tenant com um profile de verdade: check_tipo_horario resolve
  -- o tenant por auth.uid(), rodar como postgres sem contexto cai no ramo
  -- COALESCE(v_user_tenant, current_tenant_id()) e levanta "Tenant não identificado".
  SELECT p.tenant_id, p.user_id INTO v_tenant, v_uid
    FROM public.profiles p
    JOIN public.configuracoes c ON c.tenant_id = p.tenant_id
   LIMIT 1;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'FALHOU setup: nenhum tenant com profile+configuracoes no banco local';
  END IF;

  UPDATE public.configuracoes SET
    business_hours_timezone   = 'America/Sao_Paulo',
    business_hours_enabled    = true,
    business_hours = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','22:00')))),
    horario_comercial_enabled = true,
    horario_comercial = jsonb_build_object(
      'mon', jsonb_build_object('active', true, 'slots', jsonb_build_array(jsonb_build_object('start','09:00','end','18:00'))))
  WHERE tenant_id = v_tenant;

  -- A partir daqui simulamos auth.uid() de um usuário autenticado do próprio
  -- tenant (via SET LOCAL role + request.jwt.claims, padrão do teste 43).
  -- Ainda passamos p_tenant_id=v_tenant, como o brief original: agora o ramo
  -- "p_tenant_id = v_user_tenant" bate de verdade em vez de cair no fallback.
  SET LOCAL role authenticated;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  v_r := public.check_tipo_horario(NULL, '2026-08-24 19:00-03'::timestamptz, v_tenant);
  IF v_r <> 'plantao' THEN
    RAISE EXCEPTION 'FALHOU: 19:00 deveria ser plantao, veio %', v_r;
  END IF;

  v_r := public.check_tipo_horario(NULL, '2026-08-24 15:00-03'::timestamptz, v_tenant);
  IF v_r <> 'comercial' THEN
    RAISE EXCEPTION 'FALHOU: 15:00 deveria ser comercial, veio %', v_r;
  END IF;

  -- Sem cadastro comercial, volta ao comportamento anterior (09-22).
  UPDATE public.configuracoes SET horario_comercial_enabled = false WHERE tenant_id = v_tenant;
  v_r := public.check_tipo_horario(NULL, '2026-08-24 19:00-03'::timestamptz, v_tenant);
  IF v_r <> 'comercial' THEN
    RAISE EXCEPTION 'FALHOU fallback: sem cadastro, 19:00 dentro de 09-22 é comercial, veio %', v_r;
  END IF;

  RAISE NOTICE 'OK: task 5';
END $$;

ROLLBACK;
