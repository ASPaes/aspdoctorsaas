create or replace function public.vault_get_secret_id_by_name(p_name text)
returns uuid
language sql
security definer
set search_path = public, vault
as $$
  select id from vault.secrets where name = p_name limit 1;
$$;

revoke all on function public.vault_get_secret_id_by_name(text) from public, anon, authenticated;
grant execute on function public.vault_get_secret_id_by_name(text) to service_role;