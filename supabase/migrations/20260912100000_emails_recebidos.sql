-- ============================================================================
-- Recebidos: a resposta do cliente entra no DoctorSaaS
--
-- Como a resposta encontra o atendimento certo (é o desenho que Zendesk e
-- Freshdesk usam, e que o DoctorDev já roda neste grupo):
--
--   1. Todo envio ganha um `reply_token` aleatório, guardado em `email_envios`.
--   2. O e-mail sai com `Reply-To: caixa+<token>@dominio` E com `[#<token>]` no
--      fim do assunto. Dois caminhos de propósito: nem todo provedor entrega
--      endereço com sufixo, e cliente que responde trocando o destinatário
--      ainda carrega o assunto.
--   3. O leitor de caixa aceita qualquer um dos dois. Sem token, a mensagem não
--      é vinculada — e é por isso que propaganda nunca entra: campanha não
--      responde ao seu e-mail, logo nunca tem token.
--
-- A caixa é lida com EXAMINE (nunca marca como lido) e avança por marca d'água
-- de UID, guardada em `email_ingestao_estado`.
--
-- Aplicar pelo SQL Editor. Quatro blocos, idempotentes.
-- ============================================================================


-- ── Bloco 1: o token no envio ───────────────────────────────────────────────
begin;

alter table public.email_envios
  add column if not exists reply_token text;

comment on column public.email_envios.reply_token is
  'Identificação aleatória que viaja no Reply-To e no fim do assunto. É por ela que a resposta do cliente acha este envio.';

create unique index if not exists ux_email_envios_reply_token
  on public.email_envios (reply_token) where reply_token is not null;

commit;


-- ── Bloco 2: configuração por caixa ─────────────────────────────────────────
begin;

alter table public.email_accounts
  add column if not exists receber_respostas          boolean not null default false,
  add column if not exists aceitar_cliente_cadastrado boolean not null default false,
  add column if not exists descartar_automaticos      boolean not null default true;

comment on column public.email_accounts.receber_respostas is
  'Liga o leitor desta caixa. Desligado por padrão: o robô só lê caixa que alguém mandou ler.';
comment on column public.email_accounts.aceitar_cliente_cadastrado is
  'Aceita também e-mail NOVO (sem token) vindo de endereço que está na ficha de algum cliente.';
comment on column public.email_accounts.descartar_automaticos is
  'Descarta boletim, campanha e resposta automática pelos cabeçalhos que elas mesmas trazem.';

commit;


-- ── Bloco 3: as mensagens recebidas e a marca d'água da leitura ─────────────
begin;

create table if not exists public.email_recebidos (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  account_id    uuid references public.email_accounts(id) on delete set null,

  -- de qual envio esta mensagem é resposta, e o que ele carregava
  envio_id      uuid references public.email_envios(id) on delete set null,
  cliente_id    uuid references public.clientes(id) on delete set null,
  referencia_id uuid,
  origem        text,

  message_id    text,
  imap_uid      bigint,
  de_email      text not null,
  de_nome       text,
  para          text[] not null default '{}',
  assunto       text,
  corpo_texto   text,
  recebido_em   timestamptz not null,

  status        text not null default 'vinculado',
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),

  constraint email_recebidos_status_chk
    check (status in ('vinculado', 'remetente_diferente', 'avulso'))
);

comment on table public.email_recebidos is
  'Respostas dos clientes lidas das caixas. Escrita só pelo leitor (service_role).';
comment on column public.email_recebidos.status is
  'vinculado = token bateu e o remetente confere; remetente_diferente = token bateu mas veio de outro endereço (não entra no histórico sem alguém confirmar); avulso = e-mail novo de cliente cadastrado.';

create unique index if not exists ux_email_recebidos_msgid
  on public.email_recebidos (account_id, message_id) where message_id is not null;

create index if not exists ix_email_recebidos_tenant_ativo
  on public.email_recebidos (tenant_id, recebido_em desc) where deleted_at is null;

create index if not exists ix_email_recebidos_envio
  on public.email_recebidos (envio_id);

-- marca d'água: por onde a leitura parou em cada caixa
create table if not exists public.email_ingestao_estado (
  account_id    uuid primary key references public.email_accounts(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  uid_validity  bigint,
  ultimo_uid    bigint not null default 0,
  ultima_leitura timestamptz,
  ultimo_erro   text,
  mensagens_lidas integer not null default 0,
  updated_at    timestamptz not null default now()
);

comment on table public.email_ingestao_estado is
  'Até onde o leitor chegou em cada caixa. A primeira leitura planta a marca no presente e não processa nada para trás.';

alter table public.email_recebidos enable row level security;
alter table public.email_ingestao_estado enable row level security;

drop policy if exists email_recebidos_tenant_select on public.email_recebidos;
create policy email_recebidos_tenant_select on public.email_recebidos
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member())
        and tenant_id = (select public.current_tenant_id()))
  );

-- escrita só pelo leitor; a lixeira passa pela RPC do bloco 4
revoke insert, update, delete on public.email_recebidos from anon, authenticated;
revoke all on public.email_ingestao_estado from anon, authenticated;

commit;


-- ── Bloco 4: lixeira dos recebidos, com a mesma trava dos enviados ──────────
begin;

/**
 * Mesma regra dos enviados: só admin, e não sai o que está ligado a atendimento
 * ou ticket (`referencia_id`). Resposta de cliente vinculada a um atendimento é
 * prova de que ele respondeu; apagar isso reescreve o histórico.
 */
create or replace function public.fn_email_recebidos_lixeira(p_ids uuid[], p_acao text)
returns table(afetados integer, bloqueados integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := public.fn_acting_user();
  v_super    boolean := coalesce(public.is_super_admin(), false);
  v_role     text;
  v_tenant   uuid;
  v_ids      uuid[];
  v_afetados integer := 0;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;
  if p_acao not in ('lixeira', 'restaurar', 'excluir') then
    raise exception 'Ação inválida: %', p_acao;
  end if;

  select p.role, p.tenant_id into v_role, v_tenant
    from public.profiles p where p.user_id = v_uid limit 1;

  if not v_super and coalesce(v_role, '') <> 'admin' then
    raise exception 'Apenas administradores podem mexer na lixeira de e-mails.' using errcode = '42501';
  end if;

  if p_acao = 'restaurar' then
    with alvo as (
      update public.email_recebidos e set deleted_at = null
       where e.id = any(p_ids) and (v_super or e.tenant_id = v_tenant)
      returning 1
    )
    select count(*) into v_afetados from alvo;
    return query select v_afetados, 0;
    return;
  end if;

  select array_agg(e.id) into v_ids
    from public.email_recebidos e
   where e.id = any(p_ids)
     and (v_super or e.tenant_id = v_tenant)
     and e.referencia_id is null;
  v_ids := coalesce(v_ids, array[]::uuid[]);

  if p_acao = 'lixeira' then
    with alvo as (
      update public.email_recebidos e set deleted_at = now()
       where e.id = any(v_ids) and e.deleted_at is null
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      delete from public.email_recebidos e where e.id = any(v_ids) returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - cardinality(v_ids);
end;
$$;

revoke all on function public.fn_email_recebidos_lixeira(uuid[], text) from public, anon;
grant execute on function public.fn_email_recebidos_lixeira(uuid[], text) to authenticated, service_role;

commit;
