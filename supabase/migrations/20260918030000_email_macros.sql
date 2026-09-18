-- ============================================================================
-- Macros de e-mail (mockup "Macros de E-mail" aprovado pelo Alexandre em 17/09/2026)
--
-- Cadastro em Configurações › Atendimento › Canais › E-mail › Macros; uso na
-- tela Enviar e-mail (chat, chamado e jornada), pelo botão Macros ou digitando
-- "/" no começo de uma linha do texto.
--
-- Decisões:
--   - tabela própria, separada de whatsapp_macros: o corpo aqui é HTML do
--     editor, tem assunto e os campos automáticos são outros;
--   - os campos automáticos são texto {{Nome do campo}} dentro do HTML e do
--     assunto; quem preenche é a tela, com os dados do cliente;
--   - department_ids vazio = todos os setores;
--   - cadastro só admin e gestor, igual às outras abas de e-mail; todo membro
--     ativo do tenant lê e usa;
--   - anexo fixo da macro mora no bucket privado email-macro-anexos, em
--     <tenant>/<uuid>.<ext>, e NUNCA é apagado pela send-email (é da macro,
--     não do envio);
--   - "Mais usadas por você": contagem por pessoa em email_macro_usos, gravada
--     só pela fn_email_macro_usada.
--
-- Nada muda para ninguém ao aplicar: as tabelas nascem vazias.
-- Aplicar pelo SQL Editor. Blocos idempotentes.
-- ============================================================================


-- ── Bloco 1: macros ──────────────────────────────────────────────────────────
begin;

create table if not exists public.email_macros (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  titulo         text not null,
  atalho         text,
  categoria      text,
  assunto        text,
  corpo_html     text not null default '',
  department_ids uuid[] not null default '{}',
  ativo          boolean not null default true,
  usos           integer not null default 0,
  ultimo_uso_em  timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  constraint email_macros_titulo check (char_length(btrim(titulo)) between 1 and 120),
  constraint email_macros_atalho check (atalho is null or atalho ~ '^[a-z0-9_-]{1,30}$'),
  constraint email_macros_categoria check (categoria is null or char_length(categoria) <= 60),
  constraint email_macros_assunto check (assunto is null or char_length(assunto) <= 300),
  constraint email_macros_corpo check (char_length(corpo_html) <= 200000)
);

comment on table public.email_macros is
  'Macros da tela Enviar e-mail. Campos automáticos como {{Nome do campo}} no assunto e no corpo; a tela preenche com os dados do cliente. department_ids vazio = todos os setores.';

create unique index if not exists email_macros_atalho_unico
  on public.email_macros (tenant_id, atalho) where atalho is not null;
create index if not exists email_macros_tenant_idx on public.email_macros (tenant_id);

alter table public.email_macros enable row level security;

drop policy if exists email_macros_select on public.email_macros;
create policy email_macros_select on public.email_macros
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_macros_escrita on public.email_macros;
create policy email_macros_escrita on public.email_macros
  for all to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

drop trigger if exists set_updated_at_email_macros on public.email_macros;
create trigger set_updated_at_email_macros
  before update on public.email_macros
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.email_macros to authenticated;
grant all on public.email_macros to service_role;

commit;


-- ── Bloco 2: anexos fixos da macro ───────────────────────────────────────────
begin;

create table if not exists public.email_macro_anexos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  macro_id   uuid not null references public.email_macros(id) on delete cascade,
  path       text not null,
  nome       text not null,
  mime       text not null default 'application/octet-stream',
  tamanho    bigint not null default 0,
  ordem      integer not null default 0,
  created_at timestamptz not null default now(),
  constraint email_macro_anexos_path check (path ~ ('^' || tenant_id::text || '/[0-9a-f-]{36}\.[a-z0-9]{1,5}$'))
);

comment on table public.email_macro_anexos is
  'Arquivos fixos da macro de e-mail, no bucket email-macro-anexos. A send-email lê e nunca apaga.';

create index if not exists email_macro_anexos_macro_idx on public.email_macro_anexos (macro_id, ordem);

alter table public.email_macro_anexos enable row level security;

drop policy if exists email_macro_anexos_select on public.email_macro_anexos;
create policy email_macro_anexos_select on public.email_macro_anexos
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_macro_anexos_escrita on public.email_macro_anexos;
create policy email_macro_anexos_escrita on public.email_macro_anexos
  for all to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

grant select, insert, update, delete on public.email_macro_anexos to authenticated;
grant all on public.email_macro_anexos to service_role;

commit;


-- ── Bloco 3: "Mais usadas por você" ──────────────────────────────────────────
begin;

create table if not exists public.email_macro_usos (
  macro_id      uuid not null references public.email_macros(id) on delete cascade,
  user_id       uuid not null,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  usos          integer not null default 0,
  ultimo_uso_em timestamptz not null default now(),
  primary key (macro_id, user_id)
);

comment on table public.email_macro_usos is
  'Quantas vezes cada pessoa usou cada macro de e-mail. Escrita só pela fn_email_macro_usada.';

alter table public.email_macro_usos enable row level security;

-- cada um lê só a própria contagem; escrever, só pela função
drop policy if exists email_macro_usos_select on public.email_macro_usos;
create policy email_macro_usos_select on public.email_macro_usos
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.email_macro_usos from anon, authenticated;
grant select on public.email_macro_usos to authenticated;
grant all on public.email_macro_usos to service_role;

create or replace function public.fn_email_macro_usada(p_macro_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_super  boolean;
  v_ok     boolean;
begin
  if v_uid is null then
    raise exception 'nao_autenticado';
  end if;

  select m.tenant_id into v_tenant from public.email_macros m where m.id = p_macro_id;
  if v_tenant is null then
    return; -- macro apagada entre abrir a lista e usar: nada a contar
  end if;

  -- is_super_admin() pode devolver NULL: coalesce antes de decidir
  v_super := coalesce(public.is_super_admin(), false);
  select exists (
    select 1 from public.profiles p
    where p.user_id = v_uid
      and p.tenant_id = v_tenant
      and p.access_status = 'active'
      and coalesce(p.status, 'ativo') = 'ativo'
  ) into v_ok;
  if not (v_super or v_ok) then
    raise exception 'sem_permissao';
  end if;

  update public.email_macros
     set usos = usos + 1, ultimo_uso_em = now()
   where id = p_macro_id;

  insert into public.email_macro_usos (macro_id, user_id, tenant_id, usos, ultimo_uso_em)
  values (p_macro_id, v_uid, v_tenant, 1, now())
  on conflict (macro_id, user_id)
  do update set usos = public.email_macro_usos.usos + 1, ultimo_uso_em = now();
end;
$$;

revoke all on function public.fn_email_macro_usada(uuid) from public, anon;
grant execute on function public.fn_email_macro_usada(uuid) to authenticated, service_role;

commit;


-- ── Bloco 4: bucket dos anexos fixos ─────────────────────────────────────────
-- Privado. Upload pelo navegador como no macro-media do WhatsApp: a pasta de
-- cima é o tenant. Ler: membro ativo do tenant. Subir e apagar: admin e gestor.
begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('email-macro-anexos', 'email-macro-anexos', false, 18874368)
on conflict (id) do nothing;

drop policy if exists email_macro_anexos_ler on storage.objects;
create policy email_macro_anexos_ler on storage.objects
  for select to authenticated
  using (
    bucket_id = 'email-macro-anexos'
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_active_member())
          and (storage.foldername(name))[1] = (select public.current_tenant_id())::text)
    )
  );

drop policy if exists email_macro_anexos_subir on storage.objects;
create policy email_macro_anexos_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'email-macro-anexos'
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_admin_or_head())
          and (storage.foldername(name))[1] = (select public.current_tenant_id())::text)
    )
  );

drop policy if exists email_macro_anexos_apagar on storage.objects;
create policy email_macro_anexos_apagar on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'email-macro-anexos'
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_admin_or_head())
          and (storage.foldername(name))[1] = (select public.current_tenant_id())::text)
    )
  );

commit;
