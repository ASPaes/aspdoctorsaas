-- ============================================================================
-- E-mail agendado (etapa 2, item 2 do mockup aprovado em 16/09/2026)
--
-- A seta ao lado do Enviar agenda o e-mail. Ele fica guardado AQUI como estava
-- na hora de agendar (texto, conversa completa, anexos) e sai pela send-email
-- de sempre, chamada pela edge function dispatch-scheduled-emails a cada minuto.
-- Quando sai, vira uma linha normal em email_envios e esta linha aponta para ela.
--
-- Decisões do Alexandre:
--   - fora do horário a tela avisa, não bloqueia (igual à mensagem agendada do chat);
--   - mudar o TEXTO é cancelar e agendar de novo; aqui só muda o horário;
--   - quem mexe: quem agendou, e administrador ou gestor do tenant.
--
-- Escrita só por RPC (SECURITY DEFINER, perfil ativo conferido dentro, porque
-- definer passa por cima do RLS). A regra de conta é a mesma do envio na hora:
-- conta ligada a quem agenda ou a um setor dele; super admin é bypass. Ela é
-- conferida no agendamento porque, no disparo, a send-email é chamada como
-- interna e não refaz essa conferência.
--
-- Anexos: ficam no whatsapp-media até o envio. A purge-email-anexos passa a
-- pular os que pertencem a e-mail agendado ou saindo.
--
-- ORDEM: aplicar esta migration, publicar dispatch-scheduled-emails e
-- purge-email-anexos, aplicar 20260916170100 (a agenda), e só então o push.
-- Aplicar pelo SQL Editor. Uma transação só.
-- ============================================================================

begin;

create table if not exists public.email_agendados (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  agendado_por     uuid not null,
  agendar_para     timestamptz not null,
  status           text not null default 'agendado',
  tentativas       integer not null default 0,
  erro             text,
  envio_id         uuid references public.email_envios(id) on delete set null,
  enviado_em       timestamptz,
  cancelado_por    uuid,
  cancelado_em     timestamptz,
  -- o e-mail, como estava na hora de agendar
  account_id       uuid not null references public.email_accounts(id) on delete cascade,
  para             text[] not null,
  cc               text[] not null default '{}'::text[],
  cco              text[] not null default '{}'::text[],
  assunto          text not null,
  texto            text,
  html             text,
  historico_html   text,
  historico_texto  text,
  origem           text not null default 'chat',
  referencia_id    uuid,
  cliente_id       uuid,
  department_id    uuid,
  anexos           jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint email_agendados_status check (status in ('agendado', 'enviando', 'enviado', 'erro', 'cancelado')),
  constraint email_agendados_para check (cardinality(para) between 1 and 50),
  constraint email_agendados_corpo check (coalesce(length(html), 0) + coalesce(length(texto), 0) > 0),
  constraint email_agendados_anexos check (jsonb_typeof(anexos) = 'array')
);

comment on table public.email_agendados is
  'E-mail agendado pela tela Enviar e-mail. Sai pela send-email via dispatch-scheduled-emails; enviado, aponta para email_envios.';

-- o motor só olha o que está para sair
create index if not exists email_agendados_fila
  on public.email_agendados (agendar_para)
  where status = 'agendado';
-- a tela de Enviados lista os pendentes do tenant
create index if not exists email_agendados_tenant_pendentes
  on public.email_agendados (tenant_id, agendar_para)
  where status in ('agendado', 'enviando', 'erro');

alter table public.email_agendados enable row level security;

-- leitura igual à de email_envios: admin/head veem o tenant, os demais o que agendaram
drop policy if exists email_agendados_select on public.email_agendados;
create policy email_agendados_select on public.email_agendados
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
      and ((select public.is_tenant_admin_or_head()) or agendado_por = (select auth.uid()))
    )
  );

revoke all on table public.email_agendados from public, anon, authenticated;
grant select on table public.email_agendados to authenticated;
grant all on table public.email_agendados to service_role;

-- ── quem está pedindo ─────────────────────────────────────────────────────────
/**
 * Confere a sessão e devolve o tenant em que a pessoa age. Super admin age no
 * tenant que informou (simulação); os demais só no próprio, com perfil ativo.
 */
create or replace function public.fn_email__quem_agenda(p_tenant_id uuid)
returns table (user_id uuid, tenant_id uuid, gestor boolean, super boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.fn_acting_user();
  v_super  boolean := coalesce(public.is_super_admin(), false);
  v_role   text;
  v_tenant uuid;
  v_ativo  boolean;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;

  select p.role, p.tenant_id,
         coalesce(p.access_status, '') in ('active', 'ativo') and coalesce(p.status, 'ativo') in ('ativo', 'active')
    into v_role, v_tenant, v_ativo
    from public.profiles p where p.user_id = v_uid limit 1;

  if v_super then
    if p_tenant_id is null then
      raise exception 'Informe o tenant.' using errcode = '22023';
    end if;
    return query select v_uid, p_tenant_id, true, true;
    return;
  end if;

  if v_tenant is null or not coalesce(v_ativo, false) then
    raise exception 'Seu acesso ainda não está liberado neste tenant.' using errcode = '42501';
  end if;
  if p_tenant_id is not null and p_tenant_id <> v_tenant then
    raise exception 'Sem permissão neste tenant.' using errcode = '42501';
  end if;

  return query select v_uid, v_tenant, coalesce(v_role, '') in ('admin', 'head'), false;
end;
$$;

revoke all on function public.fn_email__quem_agenda(uuid) from public, anon, authenticated;
grant execute on function public.fn_email__quem_agenda(uuid) to service_role;

-- ── agendar ───────────────────────────────────────────────────────────────────
/**
 * Guarda o e-mail para sair em p_quando. p_email traz os mesmos campos que a
 * tela manda para a send-email: account_id, para, cc, cco, assunto, texto,
 * html, historico_html, historico_texto, origem, referencia_id, cliente_id,
 * department_id, anexos ([{path, nome, mime, bucket}]).
 */
create or replace function public.fn_email_agendar(p_tenant_id uuid, p_quando timestamptz, p_email jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  q          record;
  v_conta    uuid;
  v_para     text[];
  v_anexo    jsonb;
  v_id       uuid;
begin
  select * into q from public.fn_email__quem_agenda(p_tenant_id);

  if p_quando is null or p_quando < now() + interval '1 minute' then
    raise exception 'Escolha um horário a partir de daqui a 1 minuto.' using errcode = '22023';
  end if;
  if p_quando > now() + interval '180 days' then
    raise exception 'Dá para agendar até 180 dias à frente.' using errcode = '22023';
  end if;

  v_conta := nullif(p_email->>'account_id', '')::uuid;
  if not exists (
    select 1 from public.email_accounts a where a.id = v_conta and a.tenant_id = q.tenant_id and a.ativo
  ) then
    raise exception 'Conta de e-mail não encontrada ou inativa.' using errcode = '22023';
  end if;

  -- mesma regra do Remetente: conta ligada a quem agenda ou a um setor dele
  if not q.super and not exists (
       select 1 from public.email_account_usuarios u
        where u.account_id = v_conta and u.user_id = q.user_id
     ) and not exists (
       select 1
         from public.email_account_setores s
         join public.support_department_members m on m.department_id = s.setor_id
        where s.account_id = v_conta and m.user_id = q.user_id and m.is_active
     )
  then
    raise exception 'Esta conta de e-mail não está liberada para você.' using errcode = '42501';
  end if;

  select coalesce(array_agg(lower(btrim(x))) filter (where btrim(x) <> ''), '{}')
    into v_para
    from jsonb_array_elements_text(coalesce(p_email->'para', '[]'::jsonb)) x;
  if cardinality(v_para) = 0 then
    raise exception 'Informe pelo menos um destinatário.' using errcode = '22023';
  end if;
  if btrim(coalesce(p_email->>'assunto', '')) = '' then
    raise exception 'Informe o assunto.' using errcode = '22023';
  end if;

  -- anexo só do próprio tenant; a send-email confere o formato de novo no envio
  for v_anexo in select * from jsonb_array_elements(coalesce(p_email->'anexos', '[]'::jsonb)) loop
    if coalesce(v_anexo->>'path', '') not like q.tenant_id::text || '/%' or (v_anexo->>'path') like '%..%' then
      raise exception 'Anexo fora da área do seu tenant.' using errcode = '42501';
    end if;
  end loop;

  insert into public.email_agendados (
    tenant_id, agendado_por, agendar_para, account_id, para, cc, cco, assunto, texto, html,
    historico_html, historico_texto, origem, referencia_id, cliente_id, department_id, anexos
  ) values (
    q.tenant_id, q.user_id, p_quando, v_conta, v_para,
    coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(coalesce(p_email->'cc', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
    coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(coalesce(p_email->'cco', '[]'::jsonb)) x where btrim(x) <> ''), '{}'),
    left(btrim(p_email->>'assunto'), 300),
    nullif(p_email->>'texto', ''),
    nullif(p_email->>'html', ''),
    nullif(p_email->>'historico_html', ''),
    nullif(p_email->>'historico_texto', ''),
    coalesce(nullif(p_email->>'origem', ''), 'chat'),
    nullif(p_email->>'referencia_id', '')::uuid,
    nullif(p_email->>'cliente_id', '')::uuid,
    nullif(p_email->>'department_id', '')::uuid,
    coalesce(p_email->'anexos', '[]'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.fn_email_agendar(uuid, timestamptz, jsonb) from public, anon;
grant execute on function public.fn_email_agendar(uuid, timestamptz, jsonb) to authenticated, service_role;

-- ── mudar horário, enviar agora, cancelar ────────────────────────────────────
/**
 * p_acao: 'reagendar' (com p_quando), 'enviar_agora' ou 'cancelar'. Só vale
 * para e-mail ainda agendado. Quem mexe: quem agendou, admin/head do tenant,
 * super admin.
 */
create or replace function public.fn_email_agendado_acao(p_id uuid, p_acao text, p_quando timestamptz default null)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
  q record;
begin
  select * into a from public.email_agendados where id = p_id for update;
  if not found then
    raise exception 'E-mail agendado não encontrado.' using errcode = 'P0002';
  end if;

  select * into q from public.fn_email__quem_agenda(a.tenant_id);
  if not q.super and not q.gestor and a.agendado_por <> q.user_id then
    raise exception 'Só quem agendou, ou um administrador ou gestor, mexe neste e-mail.' using errcode = '42501';
  end if;
  if a.status <> 'agendado' then
    raise exception 'Este e-mail não está mais agendado (situação: %).', a.status using errcode = '22023';
  end if;

  if p_acao = 'reagendar' then
    if p_quando is null or p_quando < now() + interval '1 minute' then
      raise exception 'Escolha um horário a partir de daqui a 1 minuto.' using errcode = '22023';
    end if;
    if p_quando > now() + interval '180 days' then
      raise exception 'Dá para agendar até 180 dias à frente.' using errcode = '22023';
    end if;
    update public.email_agendados set agendar_para = p_quando, updated_at = now() where id = p_id;
  elsif p_acao = 'enviar_agora' then
    update public.email_agendados set agendar_para = now(), updated_at = now() where id = p_id;
  elsif p_acao = 'cancelar' then
    update public.email_agendados
       set status = 'cancelado', cancelado_por = q.user_id, cancelado_em = now(), updated_at = now()
     where id = p_id;
  else
    raise exception 'Ação inválida: %', p_acao using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.fn_email_agendado_acao(uuid, text, timestamptz) from public, anon;
grant execute on function public.fn_email_agendado_acao(uuid, text, timestamptz) to authenticated, service_role;

-- ── motor (só service_role) ──────────────────────────────────────────────────
/**
 * Pega até p_limite e-mails vencidos e marca como 'enviando'. Antes, o que
 * ficou em 'enviando' há mais de 15 minutos (função que morreu no meio) vira
 * erro, e NÃO é reenviado: pode ter saído, e e-mail duplicado para cliente é
 * pior do que pedir para conferir.
 */
create or replace function public.fn_email_agendados_pegar(p_limite integer default 20)
returns setof public.email_agendados
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  p record;
begin
  for p in
    update public.email_agendados
       set status = 'erro',
           erro = 'O envio foi interrompido no meio. Confira em Enviados se ele saiu antes de agendar de novo.',
           updated_at = now()
     where status = 'enviando' and updated_at < now() - interval '15 minutes'
     returning id, tenant_id, agendado_por, assunto
  loop
    perform public.fn_notify_user(
      p.tenant_id, p.agendado_por, 'email_agendado_erro', 'warning',
      'E-mail agendado não confirmado', coalesce(p.assunto, ''), '/emails', jsonb_build_object('agendado_id', p.id), null
    );
  end loop;

  return query
  update public.email_agendados e
     set status = 'enviando', tentativas = e.tentativas + 1, updated_at = now()
   where e.id in (
     select g.id from public.email_agendados g
      where g.status = 'agendado' and g.agendar_para <= now()
      order by g.agendar_para
      limit greatest(1, least(coalesce(p_limite, 20), 100))
      for update skip locked
   )
  returning e.*;
end;
$$;

revoke all on function public.fn_email_agendados_pegar(integer) from public, anon, authenticated;
grant execute on function public.fn_email_agendados_pegar(integer) to service_role;

/** resultado do envio; no erro, avisa quem agendou */
create or replace function public.fn_email_agendado_finalizar(p_id uuid, p_ok boolean, p_erro text, p_envio_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  a record;
begin
  update public.email_agendados
     set status = case when p_ok then 'enviado' else 'erro' end,
         erro = case when p_ok then null else left(coalesce(p_erro, 'Falha no envio.'), 500) end,
         envio_id = p_envio_id,
         enviado_em = case when p_ok then now() end,
         updated_at = now()
   where id = p_id and status = 'enviando'
  returning tenant_id, agendado_por, assunto into a;

  if found and not p_ok then
    perform public.fn_notify_user(
      a.tenant_id, a.agendado_por, 'email_agendado_erro', 'warning',
      'E-mail agendado não saiu',
      coalesce(a.assunto, '') || ': ' || left(coalesce(p_erro, 'falha no envio'), 200),
      '/emails', jsonb_build_object('agendado_id', p_id), null
    );
  end if;
end;
$$;

revoke all on function public.fn_email_agendado_finalizar(uuid, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.fn_email_agendado_finalizar(uuid, boolean, text, uuid) to service_role;

commit;
