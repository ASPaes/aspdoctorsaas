-- DEM-0370 — mensagem automática de feriado configurável pelo tenant.
--
-- Hoje o aviso de feriado fechado é texto fixo dentro da edge function
-- (_shared/message-processor.ts), ou uma variação escrita pela IA quando o
-- tenant tem IA configurada. Nos dois casos o admin não tem como mudar o texto,
-- e quem trabalha de sobreaviso em feriado (Delvale) manda o cliente embora
-- dizendo que "o atendimento está pausado".
--
-- 3 modos, e não os 2 do pedido, porque o padrão precisa continuar sendo o
-- comportamento atual: 'auto' mantém os outros tenants exatamente como estão.
--   auto      → texto padrão da plataforma / IA (comportamento de sempre)
--   off_hours → reusa business_hours_message (a mesma de "fora do horário")
--   custom    → usa business_hours_holiday_message
alter table public.configuracoes
  add column if not exists business_hours_holiday_message_mode text not null default 'auto',
  add column if not exists business_hours_holiday_message text;

-- configuracoes tem uma linha por tenant (dezenas, não milhares): validar na
-- hora é barato e não trava escrita.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.configuracoes'::regclass
      and conname = 'configuracoes_bh_holiday_message_mode_check'
  ) then
    alter table public.configuracoes
      add constraint configuracoes_bh_holiday_message_mode_check
      check (business_hours_holiday_message_mode in ('auto', 'off_hours', 'custom'));
  end if;
end $$;

comment on column public.configuracoes.business_hours_holiday_message_mode is
  'DEM-0370: de onde sai o aviso automático em feriado fechado o dia todo. auto=texto padrão/IA, off_hours=reusa business_hours_message, custom=business_hours_holiday_message.';
comment on column public.configuracoes.business_hours_holiday_message is
  'DEM-0370: texto do aviso de feriado quando o modo é custom. Placeholders: {{greeting}}, {{holiday_name}}, {{next_start}}, {{next_when}}.';
