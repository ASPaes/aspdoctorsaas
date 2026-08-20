-- Integração AcessoFast: chave gerada no AcessoFast, colada no DoctorSaaS.
-- A chave amarra tenant do AcessoFast <-> tenant do DoctorSaaS.

create table if not exists public.acessofast_integration (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null unique references public.tenants(id) on delete cascade,
  -- Só o hash. Diferente do Omie/Hiper, esta chave nunca é reenviada a lugar
  -- nenhum: ela só é CONFERIDA quando o AcessoFast nos chama. Guardar em claro
  -- (ou no Vault, que é decifrável) seria guardar uma credencial sem precisar.
  chave_hash     text not null unique,
  chave_prefixo  text not null,
  conectado_em   timestamptz not null default now(),
  conectado_por  uuid,
  ultimo_uso_at  timestamptz,
  ultimo_status  text not null default 'conectado'
);

create index if not exists idx_acessofast_integration_hash on public.acessofast_integration(chave_hash);

alter table public.acessofast_integration enable row level security;

drop policy if exists acessofast_integration_select on public.acessofast_integration;
create policy acessofast_integration_select on public.acessofast_integration
  for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid())
  );
-- Escrita só pelas RPCs (SECURITY DEFINER). Ninguém escreve direto.

-- Hash canônico da chave. Fonte única: usado ao conectar e ao resolver.
create or replace function public.acessofast_chave_hash(p_chave text)
returns text language sql immutable
set search_path = public
as $$
  select encode(extensions.digest(convert_to(btrim(p_chave), 'UTF8'), 'sha256'), 'hex');
$$;

-- Conectar. Ao contrário de hiper_integration_connect, valida QUEM chamou:
-- p_tenant_id vindo do cliente não é autorização.
create or replace function public.acessofast_conectar(p_tenant_id uuid, p_chave text)
returns table (chave_prefixo text, conectado_em timestamptz)
language plpgsql security definer set search_path = public
as $$
declare
  v_chave text := btrim(coalesce(p_chave, ''));
  v_role  text;
  v_tid   uuid;
  v_super boolean;
begin
  if p_tenant_id is null then raise exception 'tenant_id obrigatório'; end if;
  if length(v_chave) < 16 then raise exception 'Chave inválida.'; end if;
  if length(v_chave) > 500 then raise exception 'Chave inválida.'; end if;

  select p.role, p.tenant_id, coalesce(p.is_super_admin,false)
    into v_role, v_tid, v_super
  from public.profiles p where p.user_id = auth.uid();

  if not (v_super or (v_tid = p_tenant_id and v_role = 'admin')) then
    raise exception 'Só um administrador da empresa pode conectar o AcessoFast.';
  end if;

  return query
  insert into public.acessofast_integration as ai
    (tenant_id, chave_hash, chave_prefixo, conectado_por, ultimo_status, conectado_em)
  values
    (p_tenant_id, public.acessofast_chave_hash(v_chave), left(v_chave, 6) || '…', auth.uid(), 'conectado', now())
  on conflict (tenant_id) do update set
    chave_hash    = excluded.chave_hash,
    chave_prefixo = excluded.chave_prefixo,
    conectado_por = excluded.conectado_por,
    conectado_em  = now(),
    ultimo_uso_at = null,
    ultimo_status = 'conectado'
  returning ai.chave_prefixo, ai.conectado_em;
end;
$$;

create or replace function public.acessofast_desconectar(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public
as $$
declare v_role text; v_tid uuid; v_super boolean;
begin
  select p.role, p.tenant_id, coalesce(p.is_super_admin,false)
    into v_role, v_tid, v_super
  from public.profiles p where p.user_id = auth.uid();

  if not (v_super or (v_tid = p_tenant_id and v_role = 'admin')) then
    raise exception 'Só um administrador da empresa pode desconectar o AcessoFast.';
  end if;

  delete from public.acessofast_integration where tenant_id = p_tenant_id;
end;
$$;

revoke all on function public.acessofast_conectar(uuid, text)   from public, anon;
revoke all on function public.acessofast_desconectar(uuid)      from public, anon;
revoke all on function public.acessofast_chave_hash(text)       from public, anon, authenticated;
grant execute on function public.acessofast_conectar(uuid, text) to authenticated, service_role;
grant execute on function public.acessofast_desconectar(uuid)    to authenticated, service_role;
