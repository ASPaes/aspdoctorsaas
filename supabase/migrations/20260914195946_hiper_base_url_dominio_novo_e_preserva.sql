-- O PortalHiper mudou de portalhiper.com.br para hiper.doctorsaas.com.br.
-- A API do domínio antigo está DESLIGADA (410 Gone em /api/integ/v1/*), então o
-- domínio antigo embutido aqui deixou de ser um default inofensivo: ele é uma URL
-- morta. Duas correções:
--
-- 1. O default passa a ser o domínio novo (coluna + parâmetro da RPC).
-- 2. `p_base_url` nulo/vazio agora PRESERVA a URL já gravada em vez de reescrever
--    com o default. A tela de conexão manda só {token, tenant_id} — sem isso, cada
--    rotação de token devolvia o tenant para a URL morta e a integração "parava
--    sozinha", sem ninguém ligar a queda à troca do token.

alter table public.hiper_integration
  alter column base_url set default 'https://hiper.doctorsaas.com.br';

create or replace function public.hiper_integration_connect(
  p_tenant_id uuid,
  p_token text,
  p_base_url text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_secret_id uuid;
  v_name text := 'hiper_token_' || p_tenant_id::text;
  -- null = "não me disseram a URL": preserva a que já está lá.
  v_url text := nullif(btrim(coalesce(p_base_url, '')), '');
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
    (p_tenant_id, coalesce(v_url, 'https://hiper.doctorsaas.com.br'),
     v_secret_id, true, 'nao_testado', now())
  on conflict (tenant_id) do update set
    base_url        = coalesce(v_url, public.hiper_integration.base_url),
    vault_secret_id = excluded.vault_secret_id,
    ativo           = true,
    updated_at      = now();
end;
$$;

revoke all on function public.hiper_integration_connect(uuid, text, text) from public, authenticated, anon;
grant execute on function public.hiper_integration_connect(uuid, text, text) to service_role;
