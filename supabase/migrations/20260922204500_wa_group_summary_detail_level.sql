-- DEM-0277: resumo de grupo por IA ganha nivel de detalhe (resumido | detalhado).
-- O que ja existe foi gerado no modo detalhado, entao o default preserva o passado.

alter table public.whatsapp_group_summaries
  add column if not exists detail_level text not null default 'detalhado';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.whatsapp_group_summaries'::regclass
      and conname = 'whatsapp_group_summaries_detail_level_check'
  ) then
    alter table public.whatsapp_group_summaries
      add constraint whatsapp_group_summaries_detail_level_check
      check (detail_level in ('resumido', 'detalhado'));
  end if;
end $$;

comment on column public.whatsapp_group_summaries.detail_level is
  'resumido = o essencial, poucos itens por secao; detalhado = tudo que foi tratado (padrao e o comportamento anterior a 22/09/2026).';
