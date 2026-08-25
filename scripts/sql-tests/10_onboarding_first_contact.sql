-- Smoke test da get_onboarding_first_contact.
--
-- A função tem guarda de tenant (p_tenant_id = current_tenant_id() OR is_super_admin()).
-- Rodar como `postgres` puro devolve ZERO linhas — current_tenant_id() é NULL e a guarda
-- barra, corretamente. Por isso o teste simula um usuário autenticado de verdade, e
-- testa os DOIS lados: o tenant próprio devolve dados, o tenant alheio devolve nada.
--
-- Rodar: docker exec -i supabase_db_vbngjzovjhkmietztffo psql -U postgres -d postgres -f - < este arquivo
BEGIN;

DO $$
DECLARE
  v_tenant uuid;
  v_outro uuid;
  v_user uuid;
  v_linhas int;
  v_com_contato int;
  v_negativos int;
  v_vazamento int;
BEGIN
  -- O tenant do teste é o que TEM jornada. Escolher por nome pega o ASP, que tem
  -- onboarding habilitado e zero jornadas — e o teste passaria medindo o nada.
  SELECT j.tenant_id INTO v_tenant
    FROM public.onboarding_journeys j
    JOIN public.tenants t ON t.id = j.tenant_id AND t.onboarding_enabled IS TRUE
   GROUP BY j.tenant_id ORDER BY count(*) DESC LIMIT 1;
  SELECT id INTO v_outro FROM public.tenants WHERE id <> v_tenant ORDER BY nome LIMIT 1;
  SELECT user_id INTO v_user FROM public.profiles
   WHERE tenant_id = v_tenant AND is_super_admin IS NOT TRUE LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  SELECT count(*),
         count(*) FILTER (WHERE primeiro_contato_em IS NOT NULL),
         count(*) FILTER (WHERE minutos_corridos < 0)
    INTO v_linhas, v_com_contato, v_negativos
    FROM public.get_onboarding_first_contact(v_tenant);

  -- A guarda tem que barrar o tenant alheio mesmo com a função sendo SECURITY DEFINER.
  SELECT count(*) INTO v_vazamento FROM public.get_onboarding_first_contact(v_outro);

  IF v_linhas = 0 THEN
    RAISE EXCEPTION 'SMOKE_FALHOU|a funcao devolveu ZERO linhas para o tenant % (usuario %) - guarda barrando ou tenant sem jornada', v_tenant, v_user;
  END IF;

  RAISE EXCEPTION 'SMOKE_OK|linhas=% com_contato=% negativos=% vazamento_cross_tenant=%',
    v_linhas, v_com_contato, v_negativos, v_vazamento;
END $$;

ROLLBACK;
