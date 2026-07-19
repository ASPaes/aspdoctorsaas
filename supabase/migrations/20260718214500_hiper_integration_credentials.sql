-- Entrega base_url + token (decriptado do Vault) da integração PortalHiper.
-- Usada pela edge function hiper-integration-call (service_role) para chamar a API.
-- Só service_role executa — o token nunca chega a uma role de dashboard.

create or replace function public.hiper_integration_credentials(p_tenant_id uuid)
returns table (base_url text, token text)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select h.base_url, ds.decrypted_secret
  from public.hiper_integration h
  join vault.decrypted_secrets ds on ds.id = h.vault_secret_id
  where h.tenant_id = p_tenant_id
    and h.ativo = true;
end;
$$;

-- só service_role executa. Revoga explicitamente authenticated/anon porque o
-- default privileges do Supabase concede execute a eles na criação da função —
-- "revoke from public" sozinho não os remove.
revoke all on function public.hiper_integration_credentials(uuid) from public, authenticated, anon;
grant execute on function public.hiper_integration_credentials(uuid) to service_role;
