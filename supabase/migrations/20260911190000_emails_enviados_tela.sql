-- ============================================================================
-- Tela de E-mails: o que falta no registro de enviados, e o item no menu
--
-- `email_envios` já guarda conta, destinatários, assunto, origem e situação.
-- Para a tela mostrar CLIENTE e filtrar por SETOR, faltam as duas colunas, que
-- passam a ser preenchidas no momento do envio (quem chama a send-email sabe).
--
-- `deleted_at` é a lixeira: mover para a lixeira é marcar a data; excluir de
-- vez é apagar a linha. A trava de "não excluir o que está ligado a atendimento
-- ou ticket" é a própria `referencia_id`, que já existe.
--
-- O item de menu entra no catálogo de permissões COPIANDO o formato do vizinho
-- (Certificados A1), porque esse catálogo nasceu fora do repo e os valores de
-- módulo e ordem não estão versionados em lugar nenhum.
--
-- Aplicar pelo SQL Editor. Dois blocos, idempotentes.
-- ============================================================================


-- ── Bloco 1: colunas que faltam no registro de envios ───────────────────────
begin;

alter table public.email_envios
  add column if not exists cliente_id    uuid references public.clientes(id) on delete set null,
  add column if not exists department_id uuid references public.support_departments(id) on delete set null,
  add column if not exists deleted_at    timestamptz;

comment on column public.email_envios.cliente_id is
  'Cliente a quem o e-mail se refere, preenchido por quem pediu o envio. Nulo em envio sem cliente (teste, por exemplo).';
comment on column public.email_envios.department_id is
  'Setor de onde o envio partiu, para o filtro da tela de E-mails.';
comment on column public.email_envios.deleted_at is
  'Lixeira: preenchido quando alguém manda para a lixeira. Excluir de vez apaga a linha.';

-- a tela lista por tenant, mais recentes primeiro, sem os da lixeira
create index if not exists ix_email_envios_tenant_ativo
  on public.email_envios (tenant_id, created_at desc)
  where deleted_at is null;

create index if not exists ix_email_envios_cliente
  on public.email_envios (cliente_id, created_at desc);

commit;


-- ── Bloco 2: o item E-mails no catálogo de permissões ───────────────────────
begin;

insert into public.resources (key, module, label, description, display_order, hidden, is_navigation, where_it_appears)
select
  'nav.emails',
  coalesce((select module from public.resources where key = 'nav.certificados_a1'), 'Navegação'),
  'E-mails',
  'Tela de e-mails enviados e recebidos dos clientes.',
  coalesce((select display_order + 1 from public.resources where key = 'nav.certificados_a1'), 500),
  false,
  coalesce((select is_navigation from public.resources where key = 'nav.certificados_a1'), true),
  'Menu lateral > E-mails'
on conflict (key) do nothing;

-- mesma visibilidade do vizinho; ajustável depois na tela de Permissões
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select role, 'nav.emails', can_view, can_insert, can_update, can_delete
  from public.role_permissions
 where resource_key = 'nav.certificados_a1'
on conflict (role, resource_key) do nothing;

commit;


-- ── Bloco 3: lixeira e exclusão, com a trava do vínculo ─────────────────────
begin;

/**
 * Move para a lixeira, restaura ou exclui de vez.
 *
 * Só admin (decisão do Alexandre, 11/09/2026): excluir some com a prova de que
 * o cliente recebeu, então não é ação de operador.
 *
 * E-mail ligado a atendimento ou ticket (`referencia_id` preenchido) NÃO sai,
 * nem para a lixeira: se ele some, o histórico do atendimento passa a mentir.
 * A função devolve quantos foram e quantos ficaram, para a tela dizer o motivo
 * em vez de falhar no meio.
 */
create or replace function public.fn_email_envios_lixeira(p_ids uuid[], p_acao text)
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

  -- restaurar não tem trava: devolver para a lista nunca apaga nada
  if p_acao = 'restaurar' then
    with alvo as (
      update public.email_envios e
         set deleted_at = null
       where e.id = any(p_ids)
         and (v_super or e.tenant_id = v_tenant)
      returning 1
    )
    select count(*) into v_afetados from alvo;
    return query select v_afetados, 0;
    return; -- sem isto a execução continuava e caía no ramo de exclusão
  end if;

  -- os que podem sair: sem vínculo com atendimento ou ticket
  select array_agg(e.id) into v_ids
    from public.email_envios e
   where e.id = any(p_ids)
     and (v_super or e.tenant_id = v_tenant)
     and e.referencia_id is null;
  v_ids := coalesce(v_ids, array[]::uuid[]);

  if p_acao = 'lixeira' then
    with alvo as (
      update public.email_envios e set deleted_at = now()
       where e.id = any(v_ids) and e.deleted_at is null
      returning 1
    )
    select count(*) into v_afetados from alvo;
  else
    with alvo as (
      delete from public.email_envios e where e.id = any(v_ids) returning 1
    )
    select count(*) into v_afetados from alvo;
  end if;

  return query select v_afetados, cardinality(p_ids) - cardinality(v_ids);
end;
$$;

revoke all on function public.fn_email_envios_lixeira(uuid[], text) from public, anon;
grant execute on function public.fn_email_envios_lixeira(uuid[], text) to authenticated, service_role;

commit;
