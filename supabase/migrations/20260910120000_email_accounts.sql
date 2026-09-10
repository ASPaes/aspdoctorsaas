-- ============================================================================
-- Contas de e-mail do tenant  (Configurações > Atendimento > E-mail)
--
-- Fase 1: só cadastro. Envio e teste de conexão vêm depois, em edge function.
--
-- A senha NUNCA fica em coluna: vai para o Vault, no mesmo desenho já usado
-- pelas credenciais de WhatsApp (whatsapp_instance_vault_refs +
-- vault_create_secret). A tela grava e lê pela RPC; a tabela de refs não tem
-- policy nenhuma, então authenticated não a enxerga.
--
-- Aplicar pelo SQL Editor. São 3 blocos independentes: se um falhar, os
-- anteriores continuam valendo e dá para repetir só o que faltou (tudo é
-- idempotente).
-- ============================================================================


-- ── Bloco 1: tabelas, índices, gatilhos e RLS ───────────────────────────────
begin;

create table if not exists public.email_accounts (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  rotulo       text not null,                -- "Suporte", "Financeiro", ...
  from_name    text,                         -- nome que o cliente vê ao receber
  email        text not null,
  provider     text not null default 'custom',
  setor_id     uuid references public.support_departments(id) on delete set null,

  smtp_host     text    not null,
  smtp_port     integer not null,
  smtp_security text    not null default 'ssl',
  smtp_username text    not null,

  imap_host     text,
  imap_port     integer,
  imap_security text,
  imap_username text,

  is_default   boolean not null default false,
  ativo        boolean not null default true,

  -- preenchidos pelo teste de conexão da fase 2
  last_test_at    timestamptz,
  last_test_ok    boolean,
  last_test_error text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid,
  updated_by  uuid,

  constraint email_accounts_provider_chk check (
    provider in ('gmail','outlook','yahoo','zoho','locaweb','hostinger','uolhost','custom')
  ),
  constraint email_accounts_smtp_sec_chk check (smtp_security in ('ssl','starttls','none')),
  constraint email_accounts_imap_sec_chk check (imap_security is null or imap_security in ('ssl','starttls','none')),
  constraint email_accounts_smtp_port_chk check (smtp_port between 1 and 65535),
  constraint email_accounts_imap_port_chk check (imap_port is null or imap_port between 1 and 65535),
  constraint email_accounts_email_chk      check (position('@' in email) > 1)
);

comment on table public.email_accounts is
  'Contas de e-mail que o tenant usa na operação. Senha fica no Vault (email_account_vault_refs).';

create unique index if not exists ux_email_accounts_tenant_email
  on public.email_accounts (tenant_id, lower(email));

-- uma conta padrão de envio por tenant (rede de segurança do gatilho abaixo)
create unique index if not exists ux_email_accounts_tenant_default
  on public.email_accounts (tenant_id) where is_default;

create index if not exists ix_email_accounts_tenant_ativo
  on public.email_accounts (tenant_id, ativo);

create table if not exists public.email_account_vault_refs (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.email_accounts(id) on delete cascade,
  secret_name     text not null default 'password',
  vault_secret_id uuid not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (account_id, secret_name)
);

comment on table public.email_account_vault_refs is
  'Ponte conta de e-mail -> segredo no Vault. Sem policy: só service_role e as funções SECURITY DEFINER.';

-- updated_at
drop trigger if exists trg_email_accounts_updated_at on public.email_accounts;
create trigger trg_email_accounts_updated_at
  before update on public.email_accounts
  for each row execute function public.set_updated_at();

-- só uma conta padrão por tenant, e conta inativa nunca é padrão
create or replace function public.fn_email_account_single_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.ativo then
    new.is_default := false;
  end if;

  if new.is_default then
    update public.email_accounts
       set is_default = false
     where tenant_id = new.tenant_id
       and id <> new.id
       and is_default;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_email_accounts_single_default on public.email_accounts;
create trigger trg_email_accounts_single_default
  before insert or update of is_default, ativo on public.email_accounts
  for each row execute function public.fn_email_account_single_default();

-- RLS: mesmo desenho de whatsapp_instances
alter table public.email_accounts enable row level security;

drop policy if exists email_accounts_tenant_rw on public.email_accounts;
create policy email_accounts_tenant_rw on public.email_accounts
  for all to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

alter table public.email_account_vault_refs enable row level security;
revoke all on public.email_account_vault_refs from anon, authenticated;

commit;


-- ── Bloco 2: RPCs (gravar, apagar, ler o segredo) ───────────────────────────
begin;

-- Grava conta + senha numa chamada só. p_id nulo = criação.
-- Senha vazia em edição = mantém a que já está no Vault.
create or replace function public.fn_email_account_save(
  p_rotulo        text,
  p_email         text,
  p_provider      text,
  p_smtp_host     text,
  p_smtp_port     integer,
  p_smtp_security text,
  p_smtp_username text,
  p_senha         text    default null,
  p_id            uuid    default null,
  p_tenant_id     uuid    default null,
  p_from_name     text    default null,
  p_setor_id      uuid    default null,
  p_imap_host     text    default null,
  p_imap_port     integer default null,
  p_imap_security text    default null,
  p_imap_username text    default null,
  p_is_default    boolean default false,
  p_ativo         boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_uid            uuid := public.fn_acting_user();
  v_super          boolean := coalesce(public.is_super_admin(), false);
  v_role           text;
  v_profile_tenant uuid;
  v_tenant         uuid;
  v_id             uuid;
  v_secret_id      uuid;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;

  select p.role, p.tenant_id
    into v_role, v_profile_tenant
    from public.profiles p
   where p.user_id = v_uid
   limit 1;

  v_tenant := coalesce(p_tenant_id, v_profile_tenant);
  if v_tenant is null then
    raise exception 'Tenant não identificado.' using errcode = '42501';
  end if;

  if not v_super then
    if coalesce(v_role, '') not in ('admin', 'head') then
      raise exception 'Apenas admin ou head podem cadastrar contas de e-mail.' using errcode = '42501';
    end if;
    if v_tenant is distinct from v_profile_tenant then
      raise exception 'Tenant inválido para este usuário.' using errcode = '42501';
    end if;
  end if;

  -- mensagem legível antes de o índice único responder com erro de constraint
  if exists (
    select 1 from public.email_accounts a
     where a.tenant_id = v_tenant
       and lower(a.email) = lower(btrim(p_email))
       and (p_id is null or a.id <> p_id)
  ) then
    raise exception 'Já existe uma conta com o e-mail % neste tenant.', lower(btrim(p_email));
  end if;

  if p_id is null then
    if coalesce(p_senha, '') = '' then
      raise exception 'Informe a senha da conta.';
    end if;

    insert into public.email_accounts (
      tenant_id, rotulo, from_name, email, provider, setor_id,
      smtp_host, smtp_port, smtp_security, smtp_username,
      imap_host, imap_port, imap_security, imap_username,
      is_default, ativo, created_by, updated_by
    ) values (
      v_tenant, p_rotulo, p_from_name, lower(btrim(p_email)), p_provider, p_setor_id,
      p_smtp_host, p_smtp_port, p_smtp_security, coalesce(nullif(btrim(p_smtp_username), ''), lower(btrim(p_email))),
      p_imap_host, p_imap_port, p_imap_security, p_imap_username,
      coalesce(p_is_default, false), coalesce(p_ativo, true), v_uid, v_uid
    )
    returning id into v_id;

  else
    update public.email_accounts
       set rotulo        = p_rotulo,
           from_name     = p_from_name,
           email         = lower(btrim(p_email)),
           provider      = p_provider,
           setor_id      = p_setor_id,
           smtp_host     = p_smtp_host,
           smtp_port     = p_smtp_port,
           smtp_security = p_smtp_security,
           smtp_username = coalesce(nullif(btrim(p_smtp_username), ''), lower(btrim(p_email))),
           imap_host     = p_imap_host,
           imap_port     = p_imap_port,
           imap_security = p_imap_security,
           imap_username = p_imap_username,
           is_default    = coalesce(p_is_default, false),
           ativo         = coalesce(p_ativo, true),
           updated_by    = v_uid
     where id = p_id
       and tenant_id = v_tenant
    returning id into v_id;

    if v_id is null then
      raise exception 'Conta de e-mail não encontrada neste tenant.' using errcode = '42501';
    end if;
  end if;

  -- senha: cria no Vault na primeira vez, atualiza depois. Vazia = não mexe.
  if coalesce(p_senha, '') <> '' then
    select r.vault_secret_id
      into v_secret_id
      from public.email_account_vault_refs r
     where r.account_id = v_id
       and r.secret_name = 'password';

    if v_secret_id is null then
      v_secret_id := public.vault_create_secret(
        p_senha,
        'email_account_' || v_id::text || '_password'
      );
      insert into public.email_account_vault_refs (account_id, secret_name, vault_secret_id)
      values (v_id, 'password', v_secret_id);
    else
      perform public.vault_update_secret(v_secret_id, p_senha);
      update public.email_account_vault_refs
         set updated_at = now()
       where account_id = v_id
         and secret_name = 'password';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.fn_email_account_save(
  text, text, text, text, integer, text, text, text, uuid, uuid, text, uuid,
  text, integer, text, text, boolean, boolean
) from public, anon;
grant execute on function public.fn_email_account_save(
  text, text, text, text, integer, text, text, text, uuid, uuid, text, uuid,
  text, integer, text, text, boolean, boolean
) to authenticated, service_role;


-- Apaga a conta e o segredo dela. Sem isso o Vault acumula órfão.
create or replace function public.fn_email_account_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_uid            uuid := public.fn_acting_user();
  v_super          boolean := coalesce(public.is_super_admin(), false);
  v_role           text;
  v_profile_tenant uuid;
  v_account_tenant uuid;
  v_secret_id      uuid;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;

  select p.role, p.tenant_id
    into v_role, v_profile_tenant
    from public.profiles p
   where p.user_id = v_uid
   limit 1;

  select a.tenant_id into v_account_tenant
    from public.email_accounts a
   where a.id = p_id;

  if v_account_tenant is null then
    raise exception 'Conta de e-mail não encontrada.';
  end if;

  if not v_super then
    if coalesce(v_role, '') not in ('admin', 'head') then
      raise exception 'Apenas admin ou head podem excluir contas de e-mail.' using errcode = '42501';
    end if;
    if v_account_tenant is distinct from v_profile_tenant then
      raise exception 'Conta de e-mail de outro tenant.' using errcode = '42501';
    end if;
  end if;

  select r.vault_secret_id into v_secret_id
    from public.email_account_vault_refs r
   where r.account_id = p_id
     and r.secret_name = 'password';

  delete from public.email_accounts where id = p_id;   -- cascata leva o ref

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;
end;
$$;

revoke all on function public.fn_email_account_delete(uuid) from public, anon;
grant execute on function public.fn_email_account_delete(uuid) to authenticated, service_role;


-- Leitura do segredo: só para a edge function de envio (fase 2).
-- REVOKE de authenticated é obrigatório: o default privilege do banco já dá
-- EXECUTE a authenticated em toda função nova.
create or replace function public.get_email_account_secret(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select s.decrypted_secret
    from public.email_account_vault_refs r
    join vault.decrypted_secrets s on s.id = r.vault_secret_id
   where r.account_id = p_account_id
     and r.secret_name = 'password';
$$;

revoke all on function public.get_email_account_secret(uuid) from public, anon, authenticated;
grant execute on function public.get_email_account_secret(uuid) to service_role;

commit;


-- ── Bloco 3: a aba no RBAC ──────────────────────────────────────────────────
begin;

insert into public.resources (key, module, label, description, display_order, hidden, is_navigation, where_it_appears)
values (
  'cfg.email',
  'Configurações > Atendimento',
  'E-mail',
  'Contas de e-mail da operação: suporte, financeiro, onboarding.',
  812,
  false,
  false,
  'Configurações > Atendimento > E-mail'
)
on conflict (key) do update
  set module           = excluded.module,
      label            = excluded.label,
      description      = excluded.description,
      display_order    = excluded.display_order,
      where_it_appears = excluded.where_it_appears;

-- mesmo padrão de cfg.canais / cfg.operacao: admin e head veem, user não
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
values
  ('admin', 'cfg.email', true,  false, false, false),
  ('head',  'cfg.email', true,  false, false, false),
  ('user',  'cfg.email', false, false, false, false)
on conflict (role, resource_key) do nothing;

commit;
