alter table public.whatsapp_messages
  add column if not exists mentions_everyone boolean not null default false;

comment on column public.whatsapp_messages.mentions_everyone is
  'True quando a mensagem foi enviada com mentionsEveryOne=true na Evolution API (@todos). Auditoria: combinar com sent_by_user_id + conversation_id + timestamp.';

create index if not exists idx_wm_mentions_everyone
  on public.whatsapp_messages (conversation_id, "timestamp" desc)
  where mentions_everyone;