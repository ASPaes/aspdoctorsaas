-- DEM-0448 — escopo do bloqueio de cliente.
-- Até aqui todo "bloqueio" valia só no chat (assumir/responder) e a abertura de
-- ticket passava batido. Agora quem cadastra escolhe onde o bloqueio pega;
-- o modo (block_behavior: confirm/hard) continua decidindo entre pedir
-- confirmação ou travar de vez, agora nos dois escopos.
alter table public.client_alerts
  add column if not exists blocks_atendimento boolean not null default true,
  add column if not exists blocks_ticket      boolean not null default false;

comment on column public.client_alerts.blocks_atendimento is
  'Bloqueio vale no chat (assumir/responder). Default true preserva o comportamento dos bloqueios criados antes de 22/09/2026.';
comment on column public.client_alerts.blocks_ticket is
  'Bloqueio vale na abertura de ticket. O block_behavior decide entre confirmacao e trava.';

-- "aviso" nunca bloqueia: o default true acima não pode valer para ele.
update public.client_alerts
   set blocks_atendimento = false
 where kind = 'aviso'
   and blocks_atendimento;

alter table public.client_alerts
  drop constraint if exists chk_client_alerts_escopo;
alter table public.client_alerts
  add constraint chk_client_alerts_escopo
  check (kind = 'bloqueio' or (blocks_atendimento = false and blocks_ticket = false));
