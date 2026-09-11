-- ============================================================================
-- Conta de e-mail ligada a VÁRIOS setores e a VÁRIOS usuários
--
-- Antes: email_accounts.setor_id, um setor só. Agora duas tabelas de ligação,
-- no mesmo desenho de support_department_members (FK para profiles(user_id) e
-- support_departments(id), ON DELETE CASCADE).
--
-- Compatibilidade: a tela que está no ar (push de 10/09/2026) ainda chama
-- fn_email_account_save com p_setor_id. A nova assinatura mantém todos os
-- parâmetros antigos e acrescenta p_setor_ids / p_user_ids com default null:
--   - p_setor_ids null  -> vale o p_setor_id antigo (tela velha);
--   - p_user_ids  null  -> não mexe nos usuários (tela velha nem sabe deles).
-- email_accounts.setor_id fica como "primeiro setor" até a tela velha sair;
-- depois pode ser removida.
--
-- Escrita nas ligações só pela RPC (que confere o tenant de cada setor e de
-- cada usuário). authenticated só lê, e só do próprio tenant.
--
-- Aplicar pelo SQL Editor. Dois blocos independentes e idempotentes.
-- ============================================================================


-- ── Bloco 1: tabelas de ligação, RLS e o setor que já existia ───────────────
begin;

create table if not exists public.email_account_setores (
  account_id  uuid not null references public.email_accounts(id) on delete cascade,
  setor_id    uuid not null references public.support_departments(id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (account_id, setor_id)
);

create index if not exists ix_email_account_setores_setor
  on public.email_account_setores (setor_id);

create table if not exists public.email_account_usuarios (
  account_id  uuid not null references public.email_accounts(id) on delete cascade,
  user_id     uuid not null references public.profiles(user_id) on delete cascade,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (account_id, user_id)
);

create index if not exists ix_email_account_usuarios_user
  on public.email_account_usuarios (user_id);

comment on table public.email_account_setores is
  'Setores que usam a conta de e-mail. Escrita só por fn_email_account_save.';
comment on table public.email_account_usuarios is
  'Usuários que usam a conta de e-mail. Escrita só por fn_email_account_save.';
comment on column public.email_accounts.setor_id is
  'DEPRECATED (10/09/2026): primeiro setor de email_account_setores, mantido só enquanto a tela antiga existir.';

alter table public.email_account_setores enable row level security;
alter table public.email_account_usuarios enable row level security;

drop policy if exists email_account_setores_select on public.email_account_setores;
create policy email_account_setores_select on public.email_account_setores
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_account_usuarios_select on public.email_account_usuarios;
create policy email_account_usuarios_select on public.email_account_usuarios
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

-- sem policy de escrita; o revoke é a segunda trava
revoke insert, update, delete on public.email_account_setores from anon, authenticated;
revoke insert, update, delete on public.email_account_usuarios from anon, authenticated;

-- o setor único que as contas já tinham vira a primeira ligação
insert into public.email_account_setores (account_id, setor_id, tenant_id)
select a.id, a.setor_id, a.tenant_id
  from public.email_accounts a
 where a.setor_id is not null
on conflict (account_id, setor_id) do nothing;

commit;


-- ── Bloco 2: fn_email_account_save com listas ───────────────────────────────
begin;

-- a assinatura muda (2 parâmetros novos): sem o DROP ficariam duas versões e o
-- PostgREST não saberia qual chamar
drop function if exists public.fn_email_account_save(
  text, text, text, text, integer, text, text, text, uuid, uuid, text, uuid,
  text, integer, text, text, boolean, boolean
);

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
  p_setor_id      uuid    default null,   -- tela antiga; a nova manda p_setor_ids
  p_imap_host     text    default null,
  p_imap_port     integer default null,
  p_imap_security text    default null,
  p_imap_username text    default null,
  p_is_default    boolean default false,
  p_ativo         boolean default true,
  p_setor_ids     uuid[]  default null,
  p_user_ids      uuid[]  default null
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
  v_setores        uuid[];
  v_usuarios       uuid[];
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

  -- setores: a lista nova, ou o setor único da tela antiga. Mantém a ordem de
  -- quem mandou (distinct sozinho embaralha): o primeiro vira setor_id.
  v_setores := array(
    select s
      from unnest(coalesce(p_setor_ids, case when p_setor_id is null then array[]::uuid[] else array[p_setor_id] end))
           with ordinality as t(s, ordem)
     where s is not null
     group by s
     order by min(ordem)
  );
  if exists (
    select 1 from unnest(v_setores) s
     where not exists (select 1 from public.support_departments d where d.id = s and d.tenant_id = v_tenant)
  ) then
    raise exception 'Um dos setores escolhidos não pertence a este tenant.' using errcode = '42501';
  end if;

  -- usuários: null = não mexe (tela antiga)
  if p_user_ids is not null then
    v_usuarios := array(select distinct u from unnest(p_user_ids) u where u is not null);
    if exists (
      select 1 from unnest(v_usuarios) u
       where not exists (select 1 from public.profiles p where p.user_id = u and p.tenant_id = v_tenant)
    ) then
      raise exception 'Um dos usuários escolhidos não pertence a este tenant.' using errcode = '42501';
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
      v_tenant, p_rotulo, p_from_name, lower(btrim(p_email)), p_provider, v_setores[1],
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
           setor_id      = v_setores[1],
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

  -- ligações com setor: a lista vira exatamente o que foi mandado
  delete from public.email_account_setores
   where account_id = v_id
     and not (setor_id = any(v_setores));
  insert into public.email_account_setores (account_id, setor_id, tenant_id)
  select v_id, s, v_tenant from unnest(v_setores) s
  on conflict (account_id, setor_id) do nothing;

  if v_usuarios is not null then
    delete from public.email_account_usuarios
     where account_id = v_id
       and not (user_id = any(v_usuarios));
    insert into public.email_account_usuarios (account_id, user_id, tenant_id)
    select v_id, u, v_tenant from unnest(v_usuarios) u
    on conflict (account_id, user_id) do nothing;
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
  text, integer, text, text, boolean, boolean, uuid[], uuid[]
) from public, anon;
grant execute on function public.fn_email_account_save(
  text, text, text, text, integer, text, text, text, uuid, uuid, text, uuid,
  text, integer, text, text, boolean, boolean, uuid[], uuid[]
) to authenticated, service_role;

commit;
