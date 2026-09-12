-- DEM-0207: tags dinamicas em chats de WhatsApp.
-- Catalogo proprio, separado de ticket_tags: tag de chat e operacional
-- ("Aguardando cliente", "Pendente gestao") e nao classificacao de chamado.
-- RLS espelha o padrao de ticket_tags / ticket_tag_assignments.

-- 1) Catalogo de tags por tenant
create table if not exists public.whatsapp_conversation_tags (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  color       text not null default '#3b82f6',
  is_active   boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint whatsapp_conversation_tags_name_nao_vazio check (btrim(name) <> ''),
  constraint whatsapp_conversation_tags_color_hex check (color ~ '^#[0-9a-fA-F]{6}$')
);

-- Nome unico por tenant, ignorando maiusculas. Parcial: tag desativada nao
-- bloqueia recriar o mesmo nome depois.
create unique index if not exists uq_wa_conv_tags_tenant_nome
  on public.whatsapp_conversation_tags (tenant_id, lower(name))
  where is_active;

create index if not exists idx_wa_conv_tags_tenant_ativo
  on public.whatsapp_conversation_tags (tenant_id)
  where is_active;

-- 2) Vinculo N:N conversa <-> tag
create table if not exists public.whatsapp_conversation_tag_assignments (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.whatsapp_conversations(id) on delete cascade,
  tag_id           uuid not null references public.whatsapp_conversation_tags(id) on delete cascade,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  constraint uq_wa_conv_tag_assign unique (conversation_id, tag_id)
);

-- Caminho quente: badges do header buscam por conversa.
create index if not exists idx_wa_conv_tag_assign_conversation
  on public.whatsapp_conversation_tag_assignments (conversation_id);

-- Futuro filtro "conversas com a tag X" e guarda de exclusao.
create index if not exists idx_wa_conv_tag_assign_tag
  on public.whatsapp_conversation_tag_assignments (tag_id);

-- 3) updated_at
create or replace function public.fn_wa_conv_tags_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_wa_conv_tags_touch on public.whatsapp_conversation_tags;
create trigger trg_wa_conv_tags_touch
  before update on public.whatsapp_conversation_tags
  for each row execute function public.fn_wa_conv_tags_touch();

-- 4) RLS
alter table public.whatsapp_conversation_tags enable row level security;
alter table public.whatsapp_conversation_tag_assignments enable row level security;

drop policy if exists whatsapp_conversation_tags_select on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_select
  on public.whatsapp_conversation_tags for select to authenticated
  using (
    tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    or (select public.is_super_admin())
  );

drop policy if exists whatsapp_conversation_tags_insert on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_insert
  on public.whatsapp_conversation_tags for insert to authenticated
  with check (
    tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    or (select public.is_super_admin())
  );

drop policy if exists whatsapp_conversation_tags_update on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_update
  on public.whatsapp_conversation_tags for update to authenticated
  using (
    tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    or (select public.is_super_admin())
  );

drop policy if exists whatsapp_conversation_tags_delete on public.whatsapp_conversation_tags;
create policy whatsapp_conversation_tags_delete
  on public.whatsapp_conversation_tags for delete to authenticated
  using (
    tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    or (select public.is_super_admin())
  );

drop policy if exists whatsapp_conversation_tag_assignments_select on public.whatsapp_conversation_tag_assignments;
create policy whatsapp_conversation_tag_assignments_select
  on public.whatsapp_conversation_tag_assignments for select to authenticated
  using (
    conversation_id in (
      select c.id from public.whatsapp_conversations c
      where c.tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    )
    or (select public.is_super_admin())
  );

drop policy if exists whatsapp_conversation_tag_assignments_insert on public.whatsapp_conversation_tag_assignments;
create policy whatsapp_conversation_tag_assignments_insert
  on public.whatsapp_conversation_tag_assignments for insert to authenticated
  with check (
    conversation_id in (
      select c.id from public.whatsapp_conversations c
      where c.tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    )
    or (select public.is_super_admin())
  );

drop policy if exists whatsapp_conversation_tag_assignments_delete on public.whatsapp_conversation_tag_assignments;
create policy whatsapp_conversation_tag_assignments_delete
  on public.whatsapp_conversation_tag_assignments for delete to authenticated
  using (
    conversation_id in (
      select c.id from public.whatsapp_conversations c
      where c.tenant_id in (select p.tenant_id from public.profiles p where p.user_id = (select auth.uid()))
    )
    or (select public.is_super_admin())
  );

-- 5) Grants (RLS e quem decide o que passa)
grant select, insert, update, delete on public.whatsapp_conversation_tags to authenticated;
grant select, insert, delete on public.whatsapp_conversation_tag_assignments to authenticated;
grant all on public.whatsapp_conversation_tags to service_role;
grant all on public.whatsapp_conversation_tag_assignments to service_role;

comment on table public.whatsapp_conversation_tags is
  'DEM-0207: catalogo de tags de chat por tenant. Exclusao e logica (is_active=false).';
comment on table public.whatsapp_conversation_tag_assignments is
  'DEM-0207: vinculo N:N entre whatsapp_conversations e whatsapp_conversation_tags.';
