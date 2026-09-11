-- ============================================================================
-- email_envios: uma linha por tentativa de envio da edge function send-email
--
-- Existe para responder "o cliente diz que não recebeu": quem mandou, por qual
-- conta, para quem, quando, e o que o servidor respondeu.
--
-- O CORPO do e-mail NÃO é guardado, de propósito: é conteúdo de cliente
-- duplicado sem necessidade. Assunto, destinatários e o message_id bastam para
-- achar a mensagem na caixa de saída do provedor.
--
-- Só a edge function (service_role) escreve. authenticated só lê, e só do
-- próprio tenant.
--
-- Idempotente.
-- ============================================================================

begin;

create table if not exists public.email_envios (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  account_id    uuid references public.email_accounts(id) on delete set null,

  -- guardado à parte porque a conta pode ser apagada e o registro precisa sobreviver
  remetente     text not null,
  para          text[] not null,
  cc            text[] not null default '{}',
  assunto       text not null,

  -- quem pediu o envio: 'teste' (botão da tela), e depois 'ticket', 'cobranca'...
  origem        text not null default 'manual',
  -- id do objeto de origem (ticket, cliente...), quando houver
  referencia_id uuid,

  status        text not null,
  erro          text,
  message_id    text,

  -- usuário que disparou; null quando é o próprio sistema
  enviado_por   uuid,
  created_at    timestamptz not null default now(),

  constraint email_envios_status_chk check (status in ('enviado', 'erro')),
  constraint email_envios_para_chk   check (cardinality(para) > 0)
);

comment on table public.email_envios is
  'Registro de cada tentativa da send-email. Sem corpo da mensagem, de propósito. Só service_role escreve.';

create index if not exists ix_email_envios_tenant_criado
  on public.email_envios (tenant_id, created_at desc);

create index if not exists ix_email_envios_conta_criado
  on public.email_envios (account_id, created_at desc);

alter table public.email_envios enable row level security;

drop policy if exists email_envios_tenant_select on public.email_envios;
create policy email_envios_tenant_select on public.email_envios
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

-- sem policy de escrita; o revoke é a segunda trava
revoke insert, update, delete on public.email_envios from anon, authenticated;

commit;
