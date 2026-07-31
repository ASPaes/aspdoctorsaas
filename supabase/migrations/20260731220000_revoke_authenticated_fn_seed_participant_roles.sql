-- Seed interno de papéis do onboarding: chamado só por trg_seed_onboarding_defaults, que roda
-- como dono (postgres). Estava com EXECUTE para `authenticated` — grant que o default privilege
-- do Supabase dá a toda função nova e que o REVOKE FROM PUBLIC não remove.
--
-- Sendo SECURITY DEFINER e recebendo tenant_id por parâmetro, isso permitia a qualquer usuário
-- logado semear papéis no tenant de outra empresa.
--
-- Revogar não quebra o trigger: o Postgres checa EXECUTE de trigger function no CREATE TRIGGER,
-- não a cada disparo. Verificado em produção — criar tenant continua semeando 4 papéis e 3
-- jornadas (smoke test com rollback, 31/07/2026).

REVOKE EXECUTE ON FUNCTION public.fn_seed_onboarding_participant_roles(uuid) FROM anon, authenticated;
