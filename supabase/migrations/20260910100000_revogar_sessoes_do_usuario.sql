-- Derruba as sessoes ativas de um usuario. Usado na troca de e-mail de login.
--
-- Nao existe forma de invalidar o access token (JWT) antes de ele expirar: e
-- limitacao do Supabase, esta na propria doc. O admin.signOut() da API exige o
-- JWT do proprio usuario, que ninguem tem do lado de fora.
--
-- O que da para fazer e apagar a sessao. O refresh morre junto, entao o usuario
-- cai no proximo refresh; a janela residual e o tempo que sobra do access token.
--
-- Medido em 09/09/2026: 595 sessoes vivas para 96 usuarios, a mais antiga de
-- 27/03. O projeto nao tem time-box nem timeout de inatividade, ou seja, sessao
-- aqui nunca morre sozinha. Sem esta limpeza, quem ficou com o e-mail antigo
-- continuaria logado por tempo indeterminado, que e exatamente o furo do DEM-0381.
--
-- SECURITY DEFINER porque o schema auth nao e alcancavel pela service_role
-- atraves do PostgREST.

create or replace function public.fn_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'auth'
as $function$
declare
  v_sessoes integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  -- A tabela legada de refresh guarda user_id como varchar, nao uuid.
  update auth.refresh_tokens
     set revoked = true,
         updated_at = now()
   where user_id = p_user_id::text
     and coalesce(revoked, false) = false;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessoes = row_count;

  return v_sessoes;
end;
$function$;

-- REVOKE FROM PUBLIC sozinho nao restringe nada: o default privilege do banco
-- ja concedeu EXECUTE a authenticated. Sem revogar dele por nome, qualquer
-- usuario logado derrubaria a sessao de qualquer outro.
revoke all on function public.fn_revoke_user_sessions(uuid) from public;
revoke all on function public.fn_revoke_user_sessions(uuid) from anon;
revoke all on function public.fn_revoke_user_sessions(uuid) from authenticated;
grant execute on function public.fn_revoke_user_sessions(uuid) to service_role;
