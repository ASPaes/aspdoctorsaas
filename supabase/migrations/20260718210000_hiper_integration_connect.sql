-- RPC de conexão da integração PortalHiper.
-- Guarda o token no Vault (nunca em coluna plain) e faz upsert em hiper_integration.
-- Chamada pela edge function hiper-integration-save com service_role, que resolve o
-- tenant efetivo (super admin pode gravar para o tenant simulado).

create or replace function public.hiper_integration_connect(
  p_tenant_id uuid,
  p_token text,
  p_base_url text default 'https://portalhiper.com.br'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_secret_id uuid;
  v_name text := 'hiper_token_' || p_tenant_id::text;
begin
  if p_tenant_id is null then
    raise exception 'tenant_id obrigatório';
  end if;
  if coalesce(btrim(p_token), '') = '' then
    raise exception 'token vazio';
  end if;

  select vault_secret_id into v_existing
  from public.hiper_integration
  where tenant_id = p_tenant_id;

  if v_existing is not null then
    -- rotação: reaproveita o mesmo segredo do Vault
    perform vault.update_secret(v_existing, p_token, v_name, 'PortalHiper integration token');
    v_secret_id := v_existing;
  else
    v_secret_id := vault.create_secret(p_token, v_name, 'PortalHiper integration token');
  end if;

  insert into public.hiper_integration
    (tenant_id, base_url, vault_secret_id, ativo, ultimo_status, updated_at)
  values
    (p_tenant_id, coalesce(nullif(btrim(p_base_url), ''), 'https://portalhiper.com.br'),
     v_secret_id, true, 'nao_testado', now())
  on conflict (tenant_id) do update set
    base_url        = excluded.base_url,
    vault_secret_id = excluded.vault_secret_id,
    ativo           = true,
    updated_at      = now();
end;
$$;

-- só service_role executa. Revoga explicitamente authenticated/anon porque o
-- default privileges do Supabase concede execute a eles na criação da função —
-- "revoke from public" sozinho não os remove.
revoke all on function public.hiper_integration_connect(uuid, text, text) from public, authenticated, anon;
grant execute on function public.hiper_integration_connect(uuid, text, text) to service_role;
