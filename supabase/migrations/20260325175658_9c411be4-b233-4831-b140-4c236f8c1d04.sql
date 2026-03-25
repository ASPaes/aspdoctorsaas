
alter table public.configuracoes
  add column if not exists business_hours_enabled boolean not null default false,
  add column if not exists business_hours jsonb not null default '{}'::jsonb,
  add column if not exists business_hours_timezone text not null default 'America/Sao_Paulo',
  add column if not exists business_hours_message text,
  add column if not exists business_hours_ai_enabled boolean not null default false,
  add column if not exists business_hours_ai_prompt text,
  add column if not exists oncall_phone_number text,
  add column if not exists oncall_message_template text,
  add column if not exists oncall_escalation_window_minutes integer not null default 30,
  add column if not exists oncall_min_customer_messages integer not null default 3,
  add column if not exists oncall_min_elapsed_seconds integer not null default 60,
  add column if not exists oncall_repeat_cooldown_minutes integer not null default 360,
  add column if not exists oncall_urgency_keywords jsonb not null default '[
    "urgente","plantao","agora","preciso hoje","preciso agora",
    "nota fiscal","nf","faturar","faturamento","emitir nota","sem emitir",
    "travado","travad","nao consigo","não consigo","sistema travou","erro",
    "venda travada","pedido parado","cliente esperando","vou perder venda",
    "preciso faturar","preciso emitir","pdv","caixa"
  ]'::jsonb;

update public.configuracoes
set
  business_hours_message = coalesce(
    business_hours_message,
    'Olá! 👋 Nosso horário de atendimento é das {{start}} às {{end}}. Sua mensagem foi registrada e será atendida assim que possível.'
  ),
  oncall_message_template = coalesce(
    oncall_message_template,
    'Entendi sua urgência. 📞 Para atendimento de plantão, entre em contato no número: {{oncall_phone}}'
  )
where true;

comment on column public.configuracoes.business_hours is
'JSONB por dia: {"mon":{"active":true,"start":"08:00","end":"18:00"}, ...}. Sempre em timezone business_hours_timezone';

comment on column public.configuracoes.oncall_urgency_keywords is
'Lista de termos PT-BR que indicam urgência fora do horário. Editável pelo admin.';
