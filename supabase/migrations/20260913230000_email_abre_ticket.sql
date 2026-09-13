-- ============================================================================
-- E-mail do cliente vira ticket no setor certo (etapa 1: banco e robô)
--
-- Decisões do Alexandre (13/09/2026):
--   - o endereço para o qual o cliente escreveu decide o setor; regra por
--     palavra no assunto vale antes do endereço;
--   - remetente não reconhecido vai para a Triagem (nunca descartado);
--   - aceita também pelo domínio da empresa cliente (chave, padrão ligada);
--   - e-mail para o Onboarding entra na jornada ativa do cliente; sem jornada
--     ativa, vai para a Triagem;
--   - ticket nasce na fila do setor, sem responsável e sem categoria;
--   - resposta a ticket encerrado há até N dias (N por tenant, padrão 7) reabre;
--     depois do prazo abre ticket novo, ligado ao anterior pelo histórico;
--   - confirmação ao cliente com chave por tenant (padrão ligada);
--   - leitura de 1 em 1 minuto no horário comercial e de 5 em 5 fora.
--
-- Confiabilidade: o robô GUARDA o e-mail primeiro (email_recebidos, acao
-- 'pendente') e processa depois. Se abrir o ticket falhar, a linha fica em
-- 'erro' e é tentada de novo; o mesmo e-mail nunca abre dois tickets (a linha é
-- travada com FOR UPDATE SKIP LOCKED e só sai de 'pendente'/'erro' uma vez).
--
-- Nada muda em produção ao aplicar: todo endereço começa sem abrir ticket, e
-- não existe endereço cadastrado até alguém configurar.
--
-- Aplicar pelo SQL Editor. Blocos independentes e idempotentes.
-- ============================================================================


-- ── Bloco 1: parâmetros do tenant ────────────────────────────────────────────
begin;

create table if not exists public.email_recebidos_parametros (
  tenant_id               uuid primary key references public.tenants(id) on delete cascade,
  aceitar_dominio_cliente boolean not null default true,
  dias_reabrir            integer not null default 7,
  confirmar_abertura      boolean not null default true,
  updated_at              timestamptz not null default now(),
  updated_by              uuid default auth.uid(),
  constraint email_recebidos_parametros_dias check (dias_reabrir between 0 and 90)
);

comment on table public.email_recebidos_parametros is
  'Parâmetros de Recebidos por tenant. Tenant sem linha usa os padrões (domínio ligado, 7 dias, confirmação ligada).';

alter table public.email_recebidos_parametros enable row level security;

drop policy if exists email_recebidos_parametros_select on public.email_recebidos_parametros;
create policy email_recebidos_parametros_select on public.email_recebidos_parametros
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_recebidos_parametros_insert on public.email_recebidos_parametros;
create policy email_recebidos_parametros_insert on public.email_recebidos_parametros
  for insert to authenticated
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_recebidos_parametros_update on public.email_recebidos_parametros;
create policy email_recebidos_parametros_update on public.email_recebidos_parametros
  for update to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

revoke all on public.email_recebidos_parametros from anon, authenticated;
grant select, insert, update on public.email_recebidos_parametros to authenticated;
grant all on public.email_recebidos_parametros to service_role;

commit;


-- ── Bloco 2: endereços que recebem e para onde vai cada um ──────────────────
begin;

create table if not exists public.email_enderecos_destino (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  account_id    uuid not null references public.email_accounts(id) on delete cascade,
  endereco      text not null,
  abre_ticket   boolean not null default false,
  destino       text not null default 'suporte',
  department_id uuid references public.support_departments(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint email_enderecos_destino_endereco
    check (endereco = lower(btrim(endereco)) and endereco ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint email_enderecos_destino_tipo
    check (destino in ('suporte', 'onboarding')),
  -- ticket de suporte precisa de setor; onboarding usa o setor da jornada
  constraint email_enderecos_destino_setor
    check (not abre_ticket or destino = 'onboarding' or department_id is not null),
  constraint email_enderecos_destino_unico unique (tenant_id, endereco)
);

comment on table public.email_enderecos_destino is
  'Endereço que recebe e-mail (a própria conta ou outro endereço que chega na mesma caixa) e o destino do e-mail novo.';

alter table public.email_enderecos_destino enable row level security;

drop policy if exists email_enderecos_destino_select on public.email_enderecos_destino;
create policy email_enderecos_destino_select on public.email_enderecos_destino
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_enderecos_destino_insert on public.email_enderecos_destino;
create policy email_enderecos_destino_insert on public.email_enderecos_destino
  for insert to authenticated
  with check (
    exists (select 1 from public.email_accounts a where a.id = account_id and a.tenant_id = email_enderecos_destino.tenant_id)
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
    )
  );

drop policy if exists email_enderecos_destino_update on public.email_enderecos_destino;
create policy email_enderecos_destino_update on public.email_enderecos_destino
  for update to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    exists (select 1 from public.email_accounts a where a.id = account_id and a.tenant_id = email_enderecos_destino.tenant_id)
    and (
      (select coalesce(public.is_super_admin(), false))
      or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
    )
  );

drop policy if exists email_enderecos_destino_delete on public.email_enderecos_destino;
create policy email_enderecos_destino_delete on public.email_enderecos_destino
  for delete to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

revoke all on public.email_enderecos_destino from anon, authenticated;
grant select, insert, update, delete on public.email_enderecos_destino to authenticated;
grant all on public.email_enderecos_destino to service_role;

commit;


-- ── Bloco 3: regras por assunto e remetentes bloqueados ─────────────────────
begin;

create table if not exists public.email_regras_assunto (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  palavras      text[] not null,
  destino       text not null default 'suporte',
  department_id uuid references public.support_departments(id) on delete cascade,
  ordem         integer not null default 0,
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint email_regras_assunto_palavras check (cardinality(palavras) between 1 and 20),
  constraint email_regras_assunto_tipo check (destino in ('suporte', 'onboarding')),
  constraint email_regras_assunto_setor check (destino = 'onboarding' or department_id is not null)
);

comment on table public.email_regras_assunto is
  'Se o assunto tiver uma das palavras, o e-mail novo vai para este destino, antes do destino do endereço. Vale a de menor ordem.';

create table if not exists public.email_remetentes_bloqueados (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  padrao     text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),

  constraint email_remetentes_bloqueados_padrao
    check (padrao = lower(btrim(padrao)) and padrao like '%@%' and length(padrao) between 3 and 200),
  constraint email_remetentes_bloqueados_unico unique (tenant_id, padrao)
);

comment on table public.email_remetentes_bloqueados is
  'Remetente que nunca abre ticket: endereço exato, @dominio ou com * (ex.: *@newsletter.*).';

alter table public.email_regras_assunto enable row level security;
alter table public.email_remetentes_bloqueados enable row level security;

drop policy if exists email_regras_assunto_select on public.email_regras_assunto;
create policy email_regras_assunto_select on public.email_regras_assunto
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_regras_assunto_escrita on public.email_regras_assunto;
create policy email_regras_assunto_escrita on public.email_regras_assunto
  for all to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_remetentes_bloqueados_select on public.email_remetentes_bloqueados;
create policy email_remetentes_bloqueados_select on public.email_remetentes_bloqueados
  for select to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_active_member()) and tenant_id = (select public.current_tenant_id()))
  );

drop policy if exists email_remetentes_bloqueados_escrita on public.email_remetentes_bloqueados;
create policy email_remetentes_bloqueados_escrita on public.email_remetentes_bloqueados
  for all to authenticated
  using (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  )
  with check (
    (select coalesce(public.is_super_admin(), false))
    or ((select public.is_tenant_admin_or_head()) and tenant_id = (select public.current_tenant_id()))
  );

revoke all on public.email_regras_assunto from anon, authenticated;
revoke all on public.email_remetentes_bloqueados from anon, authenticated;
grant select, insert, update, delete on public.email_regras_assunto to authenticated;
grant select, insert, update, delete on public.email_remetentes_bloqueados to authenticated;
grant all on public.email_regras_assunto to service_role;
grant all on public.email_remetentes_bloqueados to service_role;

commit;


-- ── Bloco 4: o que aconteceu com cada e-mail recebido ────────────────────────
begin;

alter table public.email_recebidos
  add column if not exists endereco_destino      text,
  add column if not exists department_id         uuid references public.support_departments(id) on delete set null,
  add column if not exists ticket_id             uuid references public.support_tickets(id) on delete set null,
  add column if not exists acao                  text,
  add column if not exists acao_detalhe          text,
  add column if not exists tentativas            integer not null default 0,
  add column if not exists processado_em         timestamptz,
  add column if not exists confirmacao           text,
  add column if not exists confirmacao_envio_id  uuid references public.email_envios(id) on delete set null,
  add column if not exists triagem_resolvida_por uuid,
  add column if not exists triagem_resolvida_em  timestamptz;

comment on column public.email_recebidos.acao is
  'pendente (guardado, falta processar) | ticket_aberto | resposta_ticket | ticket_reaberto | jornada | triagem | registrado | ignorado | erro (tenta de novo).';
comment on column public.email_recebidos.confirmacao is
  'Aviso de abertura ao cliente: enviando | enviada | pulada | falhou. Nulo = ainda não tratado.';

-- o que já existia foi só registrado
update public.email_recebidos
   set acao = 'registrado', processado_em = coalesce(processado_em, created_at)
 where acao is null;

alter table public.email_recebidos drop constraint if exists email_recebidos_acao_chk;
alter table public.email_recebidos add constraint email_recebidos_acao_chk
  check (acao is null or acao in ('pendente', 'ticket_aberto', 'resposta_ticket', 'ticket_reaberto',
                                  'jornada', 'triagem', 'registrado', 'ignorado', 'erro'));

alter table public.email_recebidos drop constraint if exists email_recebidos_confirmacao_chk;
alter table public.email_recebidos add constraint email_recebidos_confirmacao_chk
  check (confirmacao is null or confirmacao in ('enviando', 'enviada', 'pulada', 'falhou'));

-- 'desconhecido': e-mail novo de quem não está na ficha de nenhum cliente
alter table public.email_recebidos drop constraint if exists email_recebidos_status_chk;
alter table public.email_recebidos add constraint email_recebidos_status_chk
  check (status in ('vinculado', 'remetente_diferente', 'avulso', 'desconhecido'));

create index if not exists ix_email_recebidos_fila
  on public.email_recebidos (tenant_id, acao, created_at) where acao in ('pendente', 'erro', 'triagem');
create index if not exists ix_email_recebidos_ticket
  on public.email_recebidos (ticket_id) where ticket_id is not null;
create index if not exists ix_email_recebidos_setor
  on public.email_recebidos (tenant_id, department_id, recebido_em desc) where deleted_at is null;

-- reserva da caixa (duas leituras da mesma caixa nunca ao mesmo tempo) e falhas seguidas
alter table public.email_ingestao_estado
  add column if not exists leitura_ate     timestamptz,
  add column if not exists falhas_seguidas integer not null default 0;

commit;


-- ── Bloco 5: a trava de ticket finalizado libera a reabertura por e-mail ────
-- Corpo copiado da produção em 13/09/2026, com um único acréscimo marcado.
begin;

create or replace function public.trg_protect_terminal_ticket()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_is_terminal boolean;
  v_role text;
BEGIN
  -- Se está sendo soft-deleted, permite (a RPC valida role)
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- [E-MAIL 13/09/2026] Reabertura pela resposta do cliente por e-mail
  -- (fn_email_processar_recebido): só sem usuário logado E com a marca da
  -- transação. Usuário logado nunca passa por aqui, mesmo que ligue a marca.
  IF auth.uid() IS NULL AND current_setting('app.reabertura_por_email', true) = 'on' THEN
    NEW.atualizado_em := now();
    RETURN NEW;
  END IF;

  -- Se status_id antigo era terminal, bloqueia update (exceto admin/head)
  IF OLD.status_id IS NOT NULL THEN
    SELECT is_terminal INTO v_is_terminal
    FROM ticket_statuses WHERE id = OLD.status_id;

    IF v_is_terminal THEN
      SELECT p.role INTO v_role
      FROM profiles p WHERE p.user_id = auth.uid();

      IF coalesce(v_role, '') NOT IN ('admin', 'head', 'super_admin') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Ticket finalizado não pode ser alterado. Solicite reabertura a um admin.';
      END IF;
    END IF;
  END IF;

  NEW.atualizado_em := now();
  RETURN NEW;
END;
$function$;

commit;


-- ── Bloco 6: quem é o cliente, abrir ticket, processar, triagem ──────────────
begin;

/** domínio de e-mail gratuito nunca identifica empresa cliente */
create or replace function public.fn_email_dominio_publico(p_dominio text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_dominio, '')) = any (array[
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
    'live.com', 'msn.com', 'yahoo.com', 'yahoo.com.br', 'icloud.com', 'me.com', 'aol.com',
    'bol.com.br', 'uol.com.br', 'terra.com.br', 'ig.com.br', 'globo.com', 'globomail.com',
    'r7.com', 'zipmail.com.br', 'protonmail.com', 'proton.me'
  ])
$$;

/** entre clientes candidatos: o único ativo, ou o único que existe; senão nulo (ambíguo) */
create or replace function public.fn_email__escolher_cliente(p_ids uuid[])
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with todos as (select c.id, c.cancelado from public.clientes c where c.id = any (p_ids)),
       ativos as (select id from todos where not cancelado)
  select case
           when (select count(*) from ativos) = 1 then (select id from ativos)
           when (select count(*) from ativos) = 0 and (select count(*) from todos) = 1 then (select id from todos)
           else null
         end
$$;

/**
 * Cliente do remetente: e-mail da ficha, depois e-mail de contato, depois
 * (se o tenant aceitar) o domínio da empresa. Motivo: ficha | contato | dominio
 * | ambiguo | dominio_ambiguo | desconhecido.
 */
create or replace function public.fn_email_cliente_do_remetente(p_tenant_id uuid, p_email text, p_aceitar_dominio boolean)
returns table (cliente_id uuid, cliente_contato_id uuid, motivo text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_dominio text := split_part(lower(btrim(coalesce(p_email, ''))), '@', 2);
  v_ids     uuid[];
  v_escolha uuid;
  v_contato uuid;
begin
  if v_email = '' or v_dominio = '' then
    return query select null::uuid, null::uuid, 'desconhecido'::text;
    return;
  end if;

  -- 1) ficha do cliente (o campo pode ter mais de um endereço, separado por ; ou ,)
  select array_agg(c.id) into v_ids
    from public.clientes c
   where c.tenant_id = p_tenant_id
     and c.email ilike '%' || v_email || '%'
     and v_email = any (regexp_split_to_array(lower(c.email), '[;,[:space:]]+'));

  if coalesce(cardinality(v_ids), 0) > 0 then
    v_escolha := public.fn_email__escolher_cliente(v_ids);
    if v_escolha is null then
      return query select null::uuid, null::uuid, 'ambiguo'::text;
      return;
    end if;
    return query select v_escolha, null::uuid, 'ficha'::text;
    return;
  end if;

  -- 2) contato do cliente
  select array_agg(distinct cc.cliente_id) into v_ids
    from public.cliente_contatos cc
    join public.clientes c on c.id = cc.cliente_id
   where c.tenant_id = p_tenant_id
     and lower(btrim(cc.email)) = v_email;

  if coalesce(cardinality(v_ids), 0) > 0 then
    v_escolha := public.fn_email__escolher_cliente(v_ids);
    if v_escolha is null then
      return query select null::uuid, null::uuid, 'ambiguo'::text;
      return;
    end if;
    select cc.id into v_contato
      from public.cliente_contatos cc
     where cc.cliente_id = v_escolha and lower(btrim(cc.email)) = v_email
     limit 1;
    return query select v_escolha, v_contato, 'contato'::text;
    return;
  end if;

  -- 3) domínio da empresa cliente
  if coalesce(p_aceitar_dominio, false) and not public.fn_email_dominio_publico(v_dominio) then
    select array_agg(distinct x.id) into v_ids
      from (
        select c.id
          from public.clientes c
         where c.tenant_id = p_tenant_id
           and c.email ilike '%@' || v_dominio || '%'
           and exists (
             select 1 from regexp_split_to_table(lower(c.email), '[;,[:space:]]+') e
              where split_part(e, '@', 2) = v_dominio
           )
        union
        select cc.cliente_id
          from public.cliente_contatos cc
          join public.clientes c on c.id = cc.cliente_id
         where c.tenant_id = p_tenant_id
           and split_part(lower(btrim(cc.email)), '@', 2) = v_dominio
      ) x;

    if coalesce(cardinality(v_ids), 0) > 0 then
      v_escolha := public.fn_email__escolher_cliente(v_ids);
      if v_escolha is null then
        return query select null::uuid, null::uuid, 'dominio_ambiguo'::text;
        return;
      end if;
      return query select v_escolha, null::uuid, 'dominio'::text;
      return;
    end if;
  end if;

  return query select null::uuid, null::uuid, 'desconhecido'::text;
  return;
end;
$$;

/** remetente na lista de bloqueados: exato, @dominio ou com * */
create or replace function public.fn_email_remetente_bloqueado(p_tenant_id uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.email_remetentes_bloqueados b
     where b.tenant_id = p_tenant_id
       and lower(btrim(coalesce(p_email, ''))) like
           replace(replace(case when b.padrao like '@%' then '*' || b.padrao else b.padrao end, '_', '\_'), '*', '%')
           escape '\'
  )
$$;

/** mensagem do cliente no histórico do ticket (não passa por add_ticket_event, que exige usuário logado) */
create or replace function public.fn_email__evento_cliente(
  p_ticket_id uuid, p_tenant_id uuid, p_recebido_id uuid,
  p_de text, p_assunto text, p_corpo text, p_extra text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
  values (
    p_tenant_id, p_ticket_id, null, 'email_cliente',
    concat_ws(E'\n\n',
      nullif(btrim(coalesce(p_extra, '')), ''),
      'De: ' || coalesce(p_de, '') || coalesce(E'\nAssunto: ' || nullif(btrim(p_assunto), ''), ''),
      coalesce(nullif(btrim(p_corpo), ''), '(mensagem sem texto)')
    ),
    p_recebido_id::text
  )
$$;

/**
 * Abre o ticket de suporte com as regras de create_manual_ticket, sem exigir
 * usuário logado: status inicial do setor, comercial ou plantão pelo horário do
 * setor, canal e-mail. Setor sem status inicial não gera ticket sem status:
 * levanta EMAIL_SETOR_SEM_STATUS, e quem chamou manda para a Triagem.
 */
create or replace function public.fn_email__criar_ticket(
  p_tenant_id uuid, p_cliente_id uuid, p_cliente_contato_id uuid,
  p_department_id uuid, p_assunto text, p_criado_por uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status uuid;
  v_tipo   text;
  v_id     uuid;
begin
  select s.id into v_status
    from public.ticket_statuses s
   where s.tenant_id = p_tenant_id
     and s.department_id = p_department_id
     and s.is_initial and s.is_active
   order by s.position
   limit 1;

  if v_status is null then
    raise exception 'EMAIL_SETOR_SEM_STATUS';
  end if;

  v_tipo := case when public.is_within_business_hours(p_tenant_id, p_department_id, now())
                 then 'comercial' else 'plantao' end;

  insert into public.support_tickets (
    tenant_id, cliente_id, cliente_contato_id, department_id,
    canal_origem, tipo_horario, assunto, prioridade, status_id,
    responsavel_user_id, criado_por, aberto_em, tipo, origem_criacao, contexto,
    horario_inicio
  ) values (
    p_tenant_id, p_cliente_id, p_cliente_contato_id, p_department_id,
    'email', v_tipo, left(coalesce(nullif(btrim(p_assunto), ''), '(sem assunto)'), 300),
    'media'::support_ticket_prioridade, v_status,
    null, p_criado_por, now(), 'cliente'::support_ticket_tipo, 'email', 'suporte',
    case when v_tipo = 'plantao' then now() end
  )
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Processa um e-mail guardado pelo robô. Chamada só pelo servidor.
 * Devolve {ok, acao, detalhe, ticket_id, ticket_code, confirmar}.
 * Nunca derruba quem chamou: erro vira acao 'erro', e o robô tenta de novo.
 */
create or replace function public.fn_email_processar_recebido(p_recebido_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r               public.email_recebidos%rowtype;
  v_aceitar_dom   boolean;
  v_dias          integer;
  v_confirmar     boolean;
  v_rota_id       uuid;
  v_rota_abre     boolean;
  v_rota_destino  text;
  v_rota_setor    uuid;
  v_regra_destino text;
  v_regra_setor   uuid;
  v_destino       text;
  v_setor         uuid;
  v_cliente       uuid;
  v_contato       uuid;
  v_motivo        text;
  v_ref           uuid;
  v_t_id          uuid;
  v_t_cliente     uuid;
  v_t_setor       uuid;
  v_t_contexto    text;
  v_t_code        text;
  v_t_concluido   timestamptz;
  v_t_excluido    timestamptz;
  v_t_encerrado   boolean;
  v_status_ini    uuid;
  v_jornada       uuid;
  v_ticket        uuid;
  v_novo_code     text;
  v_acao          text;
  v_detalhe       text;
  v_status        text;
begin
  select * into r from public.email_recebidos where id = p_recebido_id for update skip locked;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'ocupado_ou_inexistente');
  end if;
  if r.acao is not null and r.acao not in ('pendente', 'erro') then
    return jsonb_build_object('ok', true, 'repetido', true, 'acao', r.acao, 'ticket_id', r.ticket_id);
  end if;

  select p.aceitar_dominio_cliente, p.dias_reabrir, p.confirmar_abertura
    into v_aceitar_dom, v_dias, v_confirmar
    from public.email_recebidos_parametros p
   where p.tenant_id = r.tenant_id;
  v_aceitar_dom := coalesce(v_aceitar_dom, true);
  v_dias        := coalesce(v_dias, 7);
  v_confirmar   := coalesce(v_confirmar, true);

  v_status  := r.status;
  v_cliente := r.cliente_id;
  v_setor   := r.department_id;

  if r.envio_id is not null then
    -- ── resposta a um e-mail que saiu do DoctorSaaS ──
    select e.referencia_id into v_ref from public.email_envios e where e.id = r.envio_id;

    select t.id, t.cliente_id, t.department_id, t.contexto, t.ticket_code, t.concluido_em, t.deleted_at,
           (coalesce(s.is_terminal, false) or t.concluido_em is not null)
      into v_t_id, v_t_cliente, v_t_setor, v_t_contexto, v_t_code, v_t_concluido, v_t_excluido, v_t_encerrado
      from public.support_tickets t
      left join public.ticket_statuses s on s.id = t.status_id
     where t.id = v_ref and t.tenant_id = r.tenant_id;

    if v_t_id is null then
      -- resposta a resumo de atendimento, e-mail de teste etc.: continua só registrada
      v_acao := 'registrado';

    elsif r.status = 'remetente_diferente' then
      v_acao := 'registrado';
      v_detalhe := 'Veio de outro endereço: não entrou no ticket ' || v_t_code || ' sem alguém confirmar.';

    elsif v_t_excluido is not null then
      v_acao := 'triagem';
      v_setor := v_t_setor;
      v_cliente := coalesce(v_cliente, v_t_cliente);
      v_detalhe := 'Resposta ao ticket ' || v_t_code || ', que foi excluído.';

    else
      v_setor := v_t_setor;
      v_cliente := coalesce(v_cliente, v_t_cliente);

      if v_t_contexto = 'onboarding' then
        perform public.fn_email__evento_cliente(v_t_id, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
        v_ticket := v_t_id;
        v_acao := 'jornada';

      elsif not v_t_encerrado then
        perform public.fn_email__evento_cliente(v_t_id, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
        v_ticket := v_t_id;
        v_acao := 'resposta_ticket';

      elsif coalesce(v_t_concluido, now()) >= now() - make_interval(days => v_dias) then
        perform public.fn_email__evento_cliente(v_t_id, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
        v_ticket := v_t_id;

        select s.id into v_status_ini
          from public.ticket_statuses s
         where s.tenant_id = r.tenant_id and s.department_id = v_t_setor and s.is_initial and s.is_active
         order by s.position
         limit 1;

        if v_status_ini is null then
          v_acao := 'triagem';
          v_detalhe := 'O ticket ' || v_t_code || ' está encerrado e o setor não tem status inicial para reabrir.';
        else
          perform set_config('app.reabertura_por_email', 'on', true);
          update public.support_tickets
             set status_id = v_status_ini, concluido_em = null, closed_by = null
           where id = v_t_id;
          perform set_config('app.reabertura_por_email', 'off', true);

          insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
          values (r.tenant_id, v_t_id, null, 'email_reaberto', 'Reaberto porque o cliente respondeu por e-mail.', r.id::text);
          v_acao := 'ticket_reaberto';
        end if;

      else
        -- encerrado há mais tempo que o prazo: ticket novo, ligado ao anterior pelo histórico
        begin
          v_ticket := public.fn_email__criar_ticket(r.tenant_id, v_cliente, null, v_t_setor, r.assunto, null);
          select t.ticket_code into v_novo_code from public.support_tickets t where t.id = v_ticket;
          perform public.fn_email__evento_cliente(
            v_ticket, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto,
            'Continuação do ticket ' || v_t_code || ', encerrado há mais de ' || v_dias || ' dias.'
          );
          insert into public.support_ticket_events (tenant_id, ticket_id, user_id, event_type, content, new_value)
          values (r.tenant_id, v_t_id, null, 'email_continuacao',
                  'O cliente respondeu depois do prazo de reabertura; a conversa seguiu no ticket ' || v_novo_code || '.', v_ticket::text);
          v_acao := 'ticket_aberto';
          v_detalhe := 'Continuação do ticket ' || v_t_code || '.';
        exception when others then
          if sqlerrm <> 'EMAIL_SETOR_SEM_STATUS' then
            raise;
          end if;
          v_ticket := null;
          v_acao := 'triagem';
          v_detalhe := 'Resposta ao ticket ' || v_t_code || ' fora do prazo, e o setor não tem status inicial para abrir outro.';
        end;
      end if;
    end if;

  else
    -- ── e-mail novo ──
    select d.id, d.abre_ticket, d.destino, d.department_id
      into v_rota_id, v_rota_abre, v_rota_destino, v_rota_setor
      from public.email_enderecos_destino d
     where d.tenant_id = r.tenant_id
       and d.endereco = lower(btrim(coalesce(r.endereco_destino, '')));

    if v_rota_id is null or not v_rota_abre then
      v_acao := case when r.cliente_id is not null then 'registrado' else 'ignorado' end;

    elsif public.fn_email_remetente_bloqueado(r.tenant_id, r.de_email) then
      v_acao := 'ignorado';
      v_detalhe := 'Remetente bloqueado em Parâmetros de Recebidos.';

    else
      v_destino := v_rota_destino;
      v_setor := v_rota_setor;

      select g.destino, g.department_id
        into v_regra_destino, v_regra_setor
        from public.email_regras_assunto g
       where g.tenant_id = r.tenant_id
         and g.ativo
         and exists (
           select 1 from unnest(g.palavras) w
            where btrim(w) <> ''
              and strpos(lower(coalesce(r.assunto, '')), lower(btrim(w))) > 0
         )
       order by g.ordem, g.created_at
       limit 1;

      if v_regra_destino is not null then
        v_destino := v_regra_destino;
        v_setor := coalesce(v_regra_setor, v_setor);
        v_detalhe := 'Pela regra de assunto.';
      end if;

      select x.cliente_id, x.cliente_contato_id, x.motivo
        into v_cliente, v_contato, v_motivo
        from public.fn_email_cliente_do_remetente(r.tenant_id, r.de_email, v_aceitar_dom) x;

      if v_cliente is null then
        v_acao := 'triagem';
        if v_motivo = 'desconhecido' then
          v_status := 'desconhecido';
        end if;
        v_detalhe := case v_motivo
          when 'ambiguo' then 'O remetente está na ficha de mais de um cliente.'
          when 'dominio_ambiguo' then 'O domínio do remetente pertence a mais de um cliente.'
          else 'O remetente não está na ficha de nenhum cliente.'
        end;

      elsif v_destino = 'onboarding' then
        select j.ticket_id into v_jornada
          from public.onboarding_journeys j
         where j.tenant_id = r.tenant_id
           and j.cliente_id = v_cliente
           and j.situacao in ('nao_iniciado', 'em_andamento', 'parado')
         order by j.created_at desc
         limit 1;

        if v_jornada is null then
          v_acao := 'triagem';
          v_detalhe := 'O cliente não tem jornada de onboarding ativa.';
        else
          perform public.fn_email__evento_cliente(v_jornada, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
          select coalesce(t.department_id, v_setor) into v_setor from public.support_tickets t where t.id = v_jornada;
          v_ticket := v_jornada;
          v_acao := 'jornada';
        end if;

      else
        begin
          v_ticket := public.fn_email__criar_ticket(r.tenant_id, v_cliente, v_contato, v_setor, r.assunto, null);
          perform public.fn_email__evento_cliente(v_ticket, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);
          v_acao := 'ticket_aberto';
        exception when others then
          if sqlerrm <> 'EMAIL_SETOR_SEM_STATUS' then
            raise;
          end if;
          v_ticket := null;
          v_acao := 'triagem';
          v_detalhe := 'O setor não tem status inicial de ticket. Defina um em Tickets e status.';
        end;
      end if;
    end if;
  end if;

  update public.email_recebidos
     set acao          = v_acao,
         acao_detalhe  = v_detalhe,
         status        = v_status,
         ticket_id     = coalesce(v_ticket, ticket_id),
         referencia_id = coalesce(v_ticket, referencia_id),
         cliente_id    = coalesce(v_cliente, cliente_id),
         department_id = coalesce(v_setor, department_id),
         tentativas    = tentativas + 1,
         processado_em = now()
   where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'acao', v_acao,
    'detalhe', v_detalhe,
    'ticket_id', v_ticket,
    'ticket_code', (select t.ticket_code from public.support_tickets t where t.id = v_ticket),
    'confirmar', v_acao = 'ticket_aberto' and r.envio_id is null and v_confirmar
  );

exception when others then
  update public.email_recebidos
     set acao = 'erro', acao_detalhe = left(sqlerrm, 300), tentativas = tentativas + 1, processado_em = now()
   where id = p_recebido_id;
  return jsonb_build_object('ok', false, 'acao', 'erro', 'erro', sqlerrm);
end;
$$;

/**
 * Triagem: head ou admin escolhe o cliente (e o setor, se precisar) e abre o
 * ticket, ou ignora o e-mail. O aviso ao cliente sai na próxima leitura.
 */
create or replace function public.fn_email_triagem_resolver(
  p_recebido_id uuid, p_acao text, p_cliente_id uuid default null, p_department_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := public.fn_acting_user();
  v_super  boolean := coalesce(public.is_super_admin(), false);
  v_role   text;
  v_tenant uuid;
  v_ativo  boolean;
  r        public.email_recebidos%rowtype;
  v_setor  uuid;
  v_ticket uuid;
begin
  if v_uid is null then
    raise exception 'Sessão sem usuário identificado.' using errcode = '28000';
  end if;

  select p.role, p.tenant_id, (p.access_status = 'active' and coalesce(p.status, 'ativo') = 'ativo')
    into v_role, v_tenant, v_ativo
    from public.profiles p
   where p.user_id = v_uid
   limit 1;

  if not v_super and (coalesce(v_role, '') not in ('admin', 'head') or not coalesce(v_ativo, false)) then
    raise exception 'Apenas administradores e gestores resolvem a triagem de e-mails.' using errcode = '42501';
  end if;

  select * into r from public.email_recebidos where id = p_recebido_id for update;
  if not found or (not v_super and r.tenant_id is distinct from v_tenant) then
    raise exception 'E-mail não encontrado.' using errcode = '42501';
  end if;
  if r.acao is distinct from 'triagem' then
    raise exception 'Este e-mail já saiu da triagem.';
  end if;

  if p_acao = 'ignorar' then
    update public.email_recebidos
       set acao = 'ignorado', acao_detalhe = 'Ignorado na triagem.',
           triagem_resolvida_por = v_uid, triagem_resolvida_em = now()
     where id = r.id;
    return jsonb_build_object('ok', true, 'acao', 'ignorado');
  end if;

  if p_acao is distinct from 'abrir_ticket' then
    raise exception 'Ação inválida: %', p_acao;
  end if;

  if p_cliente_id is null or not exists (
    select 1 from public.clientes c where c.id = p_cliente_id and c.tenant_id = r.tenant_id
  ) then
    raise exception 'Escolha um cliente deste tenant.';
  end if;

  v_setor := coalesce(p_department_id, r.department_id);
  if v_setor is null or not exists (
    select 1 from public.support_departments d where d.id = v_setor and d.tenant_id = r.tenant_id
  ) then
    raise exception 'Escolha o setor do ticket.';
  end if;

  begin
    v_ticket := public.fn_email__criar_ticket(r.tenant_id, p_cliente_id, null, v_setor, r.assunto, v_uid);
  exception when others then
    if sqlerrm = 'EMAIL_SETOR_SEM_STATUS' then
      raise exception 'O setor escolhido não tem status inicial de ticket. Defina um em Tickets e status.';
    end if;
    raise;
  end;

  perform public.fn_email__evento_cliente(v_ticket, r.tenant_id, r.id, r.de_email, r.assunto, r.corpo_texto);

  update public.email_recebidos
     set acao = 'ticket_aberto',
         acao_detalhe = 'Aberto na triagem.',
         ticket_id = v_ticket,
         referencia_id = v_ticket,
         cliente_id = p_cliente_id,
         department_id = v_setor,
         status = case when status = 'desconhecido' then 'avulso' else status end,
         triagem_resolvida_por = v_uid,
         triagem_resolvida_em = now(),
         processado_em = now()
   where id = r.id;

  return jsonb_build_object(
    'ok', true, 'acao', 'ticket_aberto', 'ticket_id', v_ticket,
    'ticket_code', (select t.ticket_code from public.support_tickets t where t.id = v_ticket)
  );
end;
$$;

/** reserva a caixa para uma leitura; false = outra leitura está com ela */
create or replace function public.fn_email_ingestao_reservar(p_account_id uuid, p_tenant_id uuid, p_segundos integer default 240)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.email_ingestao_estado (account_id, tenant_id, ultimo_uid, leitura_ate, updated_at)
  values (p_account_id, p_tenant_id, 0, now() + make_interval(secs => p_segundos), now())
  on conflict (account_id) do update
     set leitura_ate = excluded.leitura_ate, updated_at = now()
   where email_ingestao_estado.leitura_ate is null
      or email_ingestao_estado.leitura_ate < now();
  return found;
end;
$$;

/**
 * Fim de uma leitura: libera a caixa e conta falhas seguidas. Na 3ª avisa os
 * admins do tenant (notify_event com cooldown); quando volta a ler, encerra o aviso.
 */
create or replace function public.fn_email_ingestao_resultado(p_account_id uuid, p_erro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant  uuid;
  v_email   text;
  v_rotulo  text;
  v_antes   integer;
  v_falhas  integer;
  v_chave   text := 'email_caixa_falhando:' || p_account_id::text;
begin
  select a.tenant_id, a.email, a.rotulo into v_tenant, v_email, v_rotulo
    from public.email_accounts a where a.id = p_account_id;
  if v_tenant is null then
    return;
  end if;

  select e.falhas_seguidas into v_antes from public.email_ingestao_estado e where e.account_id = p_account_id;

  if p_erro is null then
    update public.email_ingestao_estado
       set falhas_seguidas = 0, ultimo_erro = null, leitura_ate = null, updated_at = now()
     where account_id = p_account_id;
    if coalesce(v_antes, 0) >= 3 then
      perform public.resolve_notification_incident(v_tenant, 'email_caixa_falhando', v_chave);
    end if;
    return;
  end if;

  insert into public.email_ingestao_estado (account_id, tenant_id, ultimo_uid, falhas_seguidas, ultimo_erro, ultima_leitura, updated_at)
  values (p_account_id, v_tenant, 0, 1, left(p_erro, 500), now(), now())
  on conflict (account_id) do update
     set falhas_seguidas = email_ingestao_estado.falhas_seguidas + 1,
         ultimo_erro = left(p_erro, 500),
         ultima_leitura = now(),
         leitura_ate = null,
         updated_at = now()
  returning falhas_seguidas into v_falhas;

  if v_falhas >= 3 then
    perform public.notify_event(
      v_tenant,
      'email_caixa_falhando',
      v_chave,
      'A caixa ' || coalesce(v_rotulo, v_email) || ' não está sendo lida',
      'O DoctorSaaS tentou ler ' || v_email || ' ' || v_falhas || ' vezes seguidas e não conseguiu, então e-mail de cliente pode estar parado nessa caixa. Último erro: ' || left(p_erro, 200),
      jsonb_build_object('account_id', p_account_id, 'falhas', v_falhas),
      '/configuracoes'
    );
  end if;
end;
$$;

revoke all on function public.fn_email_dominio_publico(text) from public, anon, authenticated;
revoke all on function public.fn_email__escolher_cliente(uuid[]) from public, anon, authenticated;
revoke all on function public.fn_email_cliente_do_remetente(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fn_email_remetente_bloqueado(uuid, text) from public, anon, authenticated;
revoke all on function public.fn_email__evento_cliente(uuid, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.fn_email__criar_ticket(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.fn_email_processar_recebido(uuid) from public, anon, authenticated;
revoke all on function public.fn_email_triagem_resolver(uuid, text, uuid, uuid) from public, anon;
revoke all on function public.fn_email_ingestao_reservar(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fn_email_ingestao_resultado(uuid, text) from public, anon, authenticated;

grant execute on function public.fn_email_dominio_publico(text) to service_role;
grant execute on function public.fn_email__escolher_cliente(uuid[]) to service_role;
grant execute on function public.fn_email_cliente_do_remetente(uuid, text, boolean) to service_role;
grant execute on function public.fn_email_remetente_bloqueado(uuid, text) to service_role;
grant execute on function public.fn_email__evento_cliente(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.fn_email__criar_ticket(uuid, uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.fn_email_processar_recebido(uuid) to service_role;
grant execute on function public.fn_email_triagem_resolver(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.fn_email_ingestao_reservar(uuid, uuid, integer) to service_role;
grant execute on function public.fn_email_ingestao_resultado(uuid, text) to service_role;

commit;


-- ── Bloco 7: tipo de alerta "caixa não está sendo lida" ─────────────────────
-- categoria 'integracao': notify_event avisa os admins do tenant sem inscrição
begin;

insert into public.notification_event_types (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo)
values (
  'email_caixa_falhando',
  'Caixa de e-mail não está sendo lida',
  'O DoctorSaaS tentou ler uma caixa de e-mail 3 vezes seguidas e não conseguiu. Enquanto isso, e-mail de cliente não vira ticket. Normalmente é senha trocada ou acesso bloqueado pelo provedor.',
  'integracao',
  'warning',
  720,
  true
)
on conflict (key) do nothing;

commit;


-- ── Bloco 8: leitura de 1 em 1 minuto no comercial e de 5 em 5 fora ─────────
-- Corpo copiado da produção em 13/09/2026; muda só a regra do minuto.
begin;

create or replace function public.cron_ler_emails_recebidos()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_segredo   text;
  v_agora     timestamp := now() at time zone 'America/Sao_Paulo';
  v_comercial boolean;
begin
  v_comercial := extract(dow from v_agora) between 1 and 5
             and extract(hour from v_agora) between 7 and 18;

  -- decisão de 13/09/2026: todo minuto no comercial, de 5 em 5 fora
  if not v_comercial and extract(minute from v_agora)::int % 5 <> 0 then
    return;
  end if;

  select s.decrypted_secret into v_segredo
    from vault.decrypted_secrets s
   where s.name = 'emails_leitor_cron_secret';

  if v_segredo is null then
    raise warning 'cron_ler_emails_recebidos: segredo ausente no vault; nada disparado';
    return;
  end if;

  perform net.http_post(
    url     := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/ler-emails-recebidos',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_segredo),
    body    := '{}'::jsonb
  );
end $$;

revoke all on function public.cron_ler_emails_recebidos() from public, anon, authenticated;
grant execute on function public.cron_ler_emails_recebidos() to service_role;

commit;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'ler-emails-recebidos',
      '* * * * *',
      $cron$select public.cron_ler_emails_recebidos();$cron$
    );
    raise notice 'agenda ler-emails-recebidos: todo minuto (a funcao filtra fora do comercial)';
  else
    raise notice 'pg_cron ausente (banco local): agenda nao criada';
  end if;
end $$;
