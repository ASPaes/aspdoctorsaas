-- DEM-0229: múltiplos anexos por macro (1:N)
--
-- JÁ APLICADO EM PRODUÇÃO em 09/08/2026 via SQL Editor. Este arquivo existe
-- para registro/versionamento — não há CI de migrations neste repo.
--
-- Nota sobre as policies de storage: as 4 policies existentes do bucket
-- `macro-media` NÃO foram tocadas de propósito. As migrations não são fonte de
-- verdade do schema e o que está em produção pode divergir do arquivo do repo;
-- um DROP/CREATE cego poderia sobrescrever uma versão mais nova. Policies
-- permissivas somam com OR, então bastam policies novas e aditivas.

begin;

create table if not exists public.whatsapp_macro_anexos (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  macro_id   uuid not null references public.whatsapp_macros(id) on delete cascade,
  media_path text not null,
  media_type text not null,
  file_name  text,
  mime_type  text,
  size_bytes bigint,
  ordem      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_wa_macro_anexos_macro_ordem
  on public.whatsapp_macro_anexos (macro_id, ordem);
create index if not exists idx_wa_macro_anexos_path
  on public.whatsapp_macro_anexos (media_path);

-- backfill do anexo único atual como ordem 0 (antes do FORCE RLS)
insert into public.whatsapp_macro_anexos (tenant_id, macro_id, media_path, media_type, file_name, ordem)
select m.tenant_id, m.id, m.media_path, coalesce(m.media_type, 'document'),
       regexp_replace(m.media_path, '^.*/', ''), 0
from public.whatsapp_macros m
where m.media_path is not null
  and not exists (select 1 from public.whatsapp_macro_anexos a where a.macro_id = m.id);

alter table public.whatsapp_macro_anexos enable row level security;
alter table public.whatsapp_macro_anexos force row level security;

drop policy if exists whatsapp_macro_anexos_tenant_rw on public.whatsapp_macro_anexos;
create policy whatsapp_macro_anexos_tenant_rw on public.whatsapp_macro_anexos
  for all to authenticated
  using (public.can_access_tenant_row(tenant_id))
  with check (public.can_access_tenant_row(tenant_id));

drop trigger if exists set_tenant_id_whatsapp_macro_anexos on public.whatsapp_macro_anexos;
create trigger set_tenant_id_whatsapp_macro_anexos
  before insert on public.whatsapp_macro_anexos
  for each row execute function public.set_tenant_id_on_insert();

drop trigger if exists set_updated_at_whatsapp_macro_anexos on public.whatsapp_macro_anexos;
create trigger set_updated_at_whatsapp_macro_anexos
  before update on public.whatsapp_macro_anexos
  for each row execute function public.set_updated_at();

-- storage: policies ADITIVAS (permissivas somam com OR).
drop policy if exists macro_media_select_anexos on storage.objects;
create policy macro_media_select_anexos on storage.objects
  for select to authenticated
  using (
    bucket_id = 'macro-media'
    and exists (
      select 1 from public.whatsapp_macro_anexos a
      where a.media_path = storage.objects.name
        and a.tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid() limit 1)
    )
  );

drop policy if exists macro_media_delete_anexos on storage.objects;
create policy macro_media_delete_anexos on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'macro-media'
    and exists (
      select 1 from public.whatsapp_macro_anexos a
      where a.media_path = storage.objects.name
        and a.tenant_id = (select p.tenant_id from public.profiles p where p.user_id = auth.uid() limit 1)
    )
  );

commit;
