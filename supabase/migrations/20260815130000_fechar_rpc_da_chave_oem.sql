-- ============================================================================
-- URGENTE — a RPC que devolve a chave de integração do OEM está aberta para
-- qualquer usuário logado.
--
-- obter_chave_oem_por_conta nasceu em 14/08/2026 com a receita do CLAUDE.md:
--   revoke all ... from public;  grant execute ... to service_role;
--
-- Só que neste banco existe
--   alter default privileges for role postgres in schema public
--     grant all on functions to authenticated;
-- então TODA função criada como postgres já nasce com EXECUTE em
-- `authenticated`. `PUBLIC` e `authenticated` são papéis diferentes: o REVOKE
-- FROM PUBLIC é decorativo e não desfaz o grant do default privilege.
--
-- Medido no dump de produção de 15/08/2026:
--   GRANT ALL ON FUNCTION "public"."obter_chave_oem_por_conta"(uuid) TO "authenticated";
--
-- A função não tem portão nenhum por dentro — devolve a chave em claro para
-- quem passar o id da conta, e o id sai na view oem_integration_status, que
-- `authenticated` pode ler. Ou seja: qualquer usuário logado, de qualquer
-- tenant, lê a chave de integração de qualquer conta OEM.
--
-- A irmã do Omie (obter_chave_omie_por_conta) já está correta — só o
-- service_role. Esta ficou para trás.
-- ============================================================================

begin;

revoke all on function public.obter_chave_oem_por_conta(uuid)
  from public, anon, authenticated;
grant execute on function public.obter_chave_oem_por_conta(uuid) to service_role;

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — o certo é proacl sem `authenticated=X`:
--
--   select proname, pg_get_function_identity_arguments(oid), proacl
--     from pg_proc
--    where proname in ('obter_chave_oem_por_conta','obter_chave_omie_por_conta');
--
-- Prova de ponta a ponta, pelo PostgREST, com a chave anon do .env:
--   curl -s -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/obter_chave_oem_por_conta" \
--     -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
--     -H "Content-Type: application/json" \
--     -d '{"p_integration_id":"00000000-0000-0000-0000-000000000000"}'
--   -> tem que responder 42501 permission denied (com um JWT de usuário logado
--      também, que é o caso que estava aberto).
-- ---------------------------------------------------------------------------
