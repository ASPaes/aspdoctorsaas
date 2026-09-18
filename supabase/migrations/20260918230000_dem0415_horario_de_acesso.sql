-- DEM-0415 | Horário de acesso por setor e por usuário
--
-- ADITIVO E INERTE ATÉ ALGUÉM CRIAR UMA REGRA. Sem linha em
-- `access_schedules`, `get_my_access_window()` devolve `restricted=false` para
-- todo mundo e nada muda no login. Pode subir em qualquer horário.
--
-- DESENHO (aprovado no mockup de 18/09/2026):
--   * Regra com nome + intervalos (início, fim, dias da semana). Um dia pode ter
--     mais de um intervalo (almoço, sábado de meio período).
--   * A regra se aplica a setores e/ou pessoas. Um setor e uma pessoa ficam em
--     no máximo UMA regra (índices únicos): sem isso "qual vale?" não tem
--     resposta.
--   * Individual vence setor. Não soma horários.
--   * Admin e super admin nunca são bloqueados, para uma regra errada não
--     trancar a empresa para fora.
--   * Feriado fica fora da v1.
--
-- ONDE O BLOQUEIO ACONTECE: no login e na tela (frontend lê
-- `get_my_access_window`). Não há policy de RLS nem gancho de Auth barrando
-- a sessão. Limite declarado ao Alexandre e aceito.
--
-- ESCRITA SÓ POR RPC. As tabelas não têm grant de escrita para
-- `authenticated`: a RPC `access_schedule_save` valida que setor e pessoa são
-- do mesmo tenant da regra, coisa que uma policy de INSERT não confere (a FK de
-- `support_departments` aceita setor de outro tenant).

begin;

set local lock_timeout = '5s';

-- ─── A regra ────────────────────────────────────────────────────────────────

create table if not exists public.access_schedules (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  name                 text not null,
  timezone             text not null default 'America/Sao_Paulo',
  is_active            boolean not null default true,

  -- [{"start":"07:20","end":"20:15","days":[1,2,3,4,5]}, ...]
  -- days: 0=domingo ... 6=sábado (o mesmo de extract(dow)).
  -- end pode ser "24:00" para emendar com o dia seguinte (turno da noite =
  -- 22:00–24:00 num dia + 00:00–06:00 no outro; o cálculo junta os dois).
  intervals            jsonb not null default '[]'::jsonb,

  -- Nulo = não avisa.
  warn_before_minutes  integer default 15,
  grace_minutes        integer not null default 10,
  release_queue_on_end boolean not null default true,

  created_by           uuid default public.fn_acting_user(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint chk_access_schedules_name check (length(btrim(name)) > 0),
  constraint chk_access_schedules_warn check (warn_before_minutes is null or warn_before_minutes between 1 and 120),
  constraint chk_access_schedules_grace check (grace_minutes between 0 and 120),
  constraint chk_access_schedules_intervals_array check (jsonb_typeof(intervals) = 'array')
);

comment on table public.access_schedules is
  'DEM-0415: horário em que o usuário pode usar o sistema. Aplicada por access_schedule_targets (setor ou pessoa). Lida por get_my_access_window no login e na tela.';

drop trigger if exists trg_access_schedules_updated_at on public.access_schedules;
create trigger trg_access_schedules_updated_at
  before update on public.access_schedules
  for each row execute function public.set_updated_at();

-- ─── A quem a regra se aplica ───────────────────────────────────────────────

create table if not exists public.access_schedule_targets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  schedule_id    uuid not null references public.access_schedules(id) on delete cascade,
  department_id  uuid references public.support_departments(id) on delete cascade,
  -- profiles.user_id (NÃO profiles.id). Sem FK, igual a automation_rules.
  user_id        uuid,
  created_at     timestamptz not null default now(),

  constraint chk_access_schedule_targets_one check (num_nonnulls(department_id, user_id) = 1)
);

comment on column public.access_schedule_targets.user_id is 'profiles.user_id (NÃO profiles.id).';

create unique index if not exists uq_access_schedule_targets_department
  on public.access_schedule_targets (department_id) where department_id is not null;

create unique index if not exists uq_access_schedule_targets_user
  on public.access_schedule_targets (tenant_id, user_id) where user_id is not null;

create index if not exists idx_access_schedule_targets_schedule
  on public.access_schedule_targets (schedule_id);

-- ─── RLS: leitura para quem é do tenant; escrita nenhuma direta ─────────────

alter table public.access_schedules enable row level security;
alter table public.access_schedule_targets enable row level security;

drop policy if exists access_schedules_select on public.access_schedules;
create policy access_schedules_select
  on public.access_schedules
  for select
  using (
    (select public.is_super_admin())
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
    )
  );

drop policy if exists access_schedule_targets_select on public.access_schedule_targets;
create policy access_schedule_targets_select
  on public.access_schedule_targets
  for select
  using (
    (select public.is_super_admin())
    or (
      (select public.is_tenant_active_member())
      and tenant_id = (select public.current_tenant_id())
    )
  );

revoke all on public.access_schedules, public.access_schedule_targets from anon, authenticated;
grant select on public.access_schedules, public.access_schedule_targets to authenticated;

-- ─── Validação dos intervalos ───────────────────────────────────────────────
--
-- Devolve NULL se está tudo certo, ou a mensagem para a tela.

create or replace function public.fn_access_schedule_intervals_error(p_intervals jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_iv    jsonb;
  v_start text;
  v_end   text;
  v_day   jsonb;
  v_n     int := 0;
begin
  if p_intervals is null or jsonb_typeof(p_intervals) <> 'array' then
    return 'Intervalos inválidos.';
  end if;
  if jsonb_array_length(p_intervals) = 0 then
    return 'Adicione pelo menos um intervalo.';
  end if;
  if jsonb_array_length(p_intervals) > 50 then
    return 'No máximo 50 intervalos por regra.';
  end if;

  for v_iv in select * from jsonb_array_elements(p_intervals) loop
    v_n := v_n + 1;
    v_start := v_iv->>'start';
    v_end   := v_iv->>'end';

    if v_start is null or v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      return format('Intervalo %s: início inválido.', v_n);
    end if;
    if v_end is null or v_end !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
      return format('Intervalo %s: fim inválido.', v_n);
    end if;
    if v_end::time <= v_start::time and v_end <> '24:00' then
      return format('Intervalo %s: o fim precisa ser depois do início. Para virar a noite, use dois intervalos (até 24:00 e a partir de 00:00).', v_n);
    end if;

    if jsonb_typeof(v_iv->'days') <> 'array' or jsonb_array_length(v_iv->'days') = 0 then
      return format('Intervalo %s: marque pelo menos um dia.', v_n);
    end if;
    for v_day in select * from jsonb_array_elements(v_iv->'days') loop
      if jsonb_typeof(v_day) <> 'number' or v_day::text not in ('0','1','2','3','4','5','6') then
        return format('Intervalo %s: dia da semana inválido.', v_n);
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

-- ─── A janela: dentro agora? até quando? quando volta? ──────────────────────
--
-- Projeta os intervalos em instantes reais de ontem até daqui a 8 dias, no fuso
-- da regra, e junta os que se encostam ou se sobrepõem (07:00–12:00 +
-- 12:00–18:00 vira um só; 22:00–24:00 + 00:00–06:00 do dia seguinte também).
-- Sem a junção, quem trabalha 07–12 e 12–18 levaria o aviso de "seu horário
-- termina" às 11:45.

create or replace function public.fn_access_schedule_window(p_schedule_id uuid, p_at timestamptz default now())
returns table (allowed boolean, current_start timestamptz, current_end timestamptz,
               last_end timestamptz, next_start timestamptz)
language sql
stable
set search_path = public
as $$
  with s as (
    select timezone as tz, intervals from public.access_schedules where id = p_schedule_id
  ),
  d as (
    select ((p_at at time zone s.tz)::date + g) as day
      from s, generate_series(-1, 8) g
  ),
  raw as (
    select ((d.day + (iv->>'start')::time) at time zone s.tz) as a,
           ((d.day + (iv->>'end')::time)   at time zone s.tz) as b
      from s
      cross join d
      cross join lateral jsonb_array_elements(s.intervals) iv
     where extract(dow from d.day)::int in (select jsonb_array_elements_text(iv->'days')::int)
  ),
  ordered as (
    select a, b,
           max(b) over (order by a, b rows between unbounded preceding and 1 preceding) as prev_max
      from raw
  ),
  grp as (
    select a, b, sum(case when prev_max >= a then 0 else 1 end) over (order by a, b) as g
      from ordered
  ),
  merged as (
    select min(a) as a, max(b) as b from grp group by g
  )
  select
    exists (select 1 from merged where p_at >= a and p_at < b),
    (select a from merged where p_at >= a and p_at < b limit 1),
    (select b from merged where p_at >= a and p_at < b limit 1),
    (select max(b) from merged where b <= p_at),
    (select min(a) from merged where a > p_at);
$$;

-- ─── Qual regra vale para esta pessoa ───────────────────────────────────────
--
-- origin: 'exempt' (admin/super admin), 'user' (regra individual), 'department'
-- (regra do setor) ou 'none'. Regra individual INATIVA cai para a do setor:
-- desligar a exceção devolve a pessoa ao padrão do time, não a libera.

create or replace function public.fn_access_schedule_resolve(p_user_id uuid)
returns table (schedule_id uuid, origin text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_role   text;
  v_super  boolean;
  v_dept   uuid;
  v_id     uuid;
begin
  select p.tenant_id, p.role, coalesce(p.is_super_admin, false), f.department_id
    into v_tenant, v_role, v_super, v_dept
    from public.profiles p
    left join public.funcionarios f on f.id = p.funcionario_id
   where p.user_id = p_user_id
   limit 1;

  if not found then
    return query select null::uuid, 'none'::text; return;
  end if;
  if v_super or v_role = 'admin' then
    return query select null::uuid, 'exempt'::text; return;
  end if;

  select s.id into v_id
    from public.access_schedule_targets t
    join public.access_schedules s on s.id = t.schedule_id and s.is_active
   where t.tenant_id = v_tenant and t.user_id = p_user_id
   limit 1;
  if v_id is not null then
    return query select v_id, 'user'::text; return;
  end if;

  if v_dept is not null then
    select s.id into v_id
      from public.access_schedule_targets t
      join public.access_schedules s on s.id = t.schedule_id and s.is_active
     where t.department_id = v_dept and s.tenant_id = v_tenant
     limit 1;
    if v_id is not null then
      return query select v_id, 'department'::text; return;
    end if;
  end if;

  return query select null::uuid, 'none'::text;
end;
$$;

revoke all on function public.fn_access_schedule_resolve(uuid) from public, anon, authenticated;
grant execute on function public.fn_access_schedule_resolve(uuid) to service_role;

-- ─── O que a tela do próprio usuário consulta ───────────────────────────────
--
-- allowed ........ dentro de um intervalo agora (o login usa só isto)
-- in_grace ....... fora, mas dentro da tolerância do intervalo que acabou
-- kick_at ........ quando a sessão aberta deve cair (fim + tolerância)
-- server_now ..... para a tela corrigir relógio de máquina adiantado

create or replace function public.get_my_access_window()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_res    record;
  v_s      public.access_schedules%rowtype;
  v_w      record;
  v_grace  interval;
  v_in_grace boolean;
begin
  if v_uid is null then
    return jsonb_build_object('restricted', false, 'server_now', now());
  end if;

  select * into v_res from public.fn_access_schedule_resolve(v_uid);
  if v_res.schedule_id is null then
    return jsonb_build_object('restricted', false, 'origin', v_res.origin, 'server_now', now());
  end if;

  select * into v_s from public.access_schedules where id = v_res.schedule_id;
  select * into v_w from public.fn_access_schedule_window(v_s.id, now());
  v_grace := make_interval(mins => v_s.grace_minutes);
  v_in_grace := not v_w.allowed and v_w.last_end is not null and now() < v_w.last_end + v_grace;

  return jsonb_build_object(
    'restricted',          true,
    'origin',              v_res.origin,
    'allowed',             v_w.allowed,
    'in_grace',            v_in_grace,
    'ends_at',             case when v_w.allowed then v_w.current_end when v_in_grace then v_w.last_end end,
    'kick_at',             case when v_w.allowed then v_w.current_end + v_grace
                                when v_in_grace then v_w.last_end + v_grace end,
    'next_start_at',       v_w.next_start,
    'server_now',          now(),
    'schedule_name',       v_s.name,
    'timezone',            v_s.timezone,
    'intervals',           v_s.intervals,
    'warn_before_minutes', v_s.warn_before_minutes,
    'grace_minutes',       v_s.grace_minutes,
    'release_queue_on_end', v_s.release_queue_on_end
  );
end;
$$;

revoke all on function public.get_my_access_window() from public, anon;
grant execute on function public.get_my_access_window() to authenticated, service_role;

-- ─── Visão da empresa: quem está restrito e quem está fora agora ────────────

create or replace function public.access_schedule_overview(p_tenant_id uuid)
returns table (
  user_id uuid, nome text, role text, department_id uuid, department_name text,
  origin text, schedule_id uuid, schedule_name text,
  allowed boolean, ends_at timestamptz, next_start_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    coalesce(public.is_super_admin(), false)
    or (coalesce(public.is_tenant_admin_or_head(), false) and p_tenant_id = public.current_tenant_id())
  ) then
    raise exception 'Sem permissão para ver os horários de acesso desta empresa.' using errcode = '42501';
  end if;

  return query
  select p.user_id,
         coalesce(f.nome, 'Sem vínculo')::text,
         p.role,
         f.department_id,
         d.name,
         r.origin,
         r.schedule_id,
         s.name,
         case when r.schedule_id is null then null else w.allowed end,
         case when r.schedule_id is null then null else w.current_end end,
         case when r.schedule_id is null then null else w.next_start end
    from public.profiles p
    left join public.funcionarios f on f.id = p.funcionario_id
    left join public.support_departments d on d.id = f.department_id
    cross join lateral public.fn_access_schedule_resolve(p.user_id) r
    left join public.access_schedules s on s.id = r.schedule_id
    left join lateral public.fn_access_schedule_window(r.schedule_id, now()) w on true
   where p.tenant_id = p_tenant_id
     and p.status = 'ativo'
     and p.access_status = 'active'
   order by coalesce(f.nome, 'zzz');
end;
$$;

revoke all on function public.access_schedule_overview(uuid) from public, anon;
grant execute on function public.access_schedule_overview(uuid) to authenticated, service_role;

-- ─── Salvar (criar ou editar) ───────────────────────────────────────────────
--
-- Só admin (ou super admin). Head não: seria o gestor restringindo o próprio
-- par, ou a si mesmo sem querer.

create or replace function public.access_schedule_save(
  p_tenant_id uuid,
  p_id uuid,
  p_name text,
  p_timezone text,
  p_is_active boolean,
  p_intervals jsonb,
  p_warn_before_minutes integer,
  p_grace_minutes integer,
  p_release_queue_on_end boolean,
  p_department_ids uuid[],
  p_user_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid := p_id;
  v_err   text;
  v_nome  text;
  v_outra text;
begin
  if not (
    coalesce(public.is_super_admin(), false)
    or (coalesce(public.is_tenant_admin(), false) and p_tenant_id = public.current_tenant_id())
  ) then
    raise exception 'Só o administrador da empresa pode alterar horários de acesso.' using errcode = '42501';
  end if;

  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'Informe o nome da regra.';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Fuso horário inválido: %.', p_timezone;
  end if;
  v_err := public.fn_access_schedule_intervals_error(p_intervals);
  if v_err is not null then
    raise exception '%', v_err;
  end if;
  if coalesce(array_length(p_department_ids, 1), 0) + coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'Escolha pelo menos um setor ou uma pessoa.';
  end if;

  -- Setor e pessoa precisam ser da empresa da regra.
  if exists (
    select 1 from unnest(coalesce(p_department_ids, '{}')) x
     where not exists (select 1 from public.support_departments d where d.id = x and d.tenant_id = p_tenant_id)
  ) then
    raise exception 'Setor não encontrado nesta empresa.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_user_ids, '{}')) x
     where not exists (select 1 from public.profiles p where p.user_id = x and p.tenant_id = p_tenant_id)
  ) then
    raise exception 'Pessoa não encontrada nesta empresa.';
  end if;

  -- Já está em outra regra? Diz qual, em vez do erro cru do índice único.
  select d.name, s.name into v_nome, v_outra
    from public.access_schedule_targets t
    join public.access_schedules s on s.id = t.schedule_id
    join public.support_departments d on d.id = t.department_id
   where t.department_id = any(coalesce(p_department_ids, '{}'))
     and t.schedule_id is distinct from v_id
   limit 1;
  if v_nome is not null then
    raise exception 'O setor % já está na regra "%".', v_nome, v_outra;
  end if;

  select coalesce(f.nome, 'selecionada'), s.name into v_nome, v_outra
    from public.access_schedule_targets t
    join public.access_schedules s on s.id = t.schedule_id
    join public.profiles p on p.user_id = t.user_id
    left join public.funcionarios f on f.id = p.funcionario_id
   where t.tenant_id = p_tenant_id
     and t.user_id = any(coalesce(p_user_ids, '{}'))
     and t.schedule_id is distinct from v_id
   limit 1;
  if v_outra is not null then
    raise exception 'A pessoa % já está na regra "%".', v_nome, v_outra;
  end if;

  if v_id is null then
    insert into public.access_schedules
      (tenant_id, name, timezone, is_active, intervals, warn_before_minutes, grace_minutes, release_queue_on_end)
    values
      (p_tenant_id, btrim(p_name), p_timezone, coalesce(p_is_active, true), p_intervals,
       p_warn_before_minutes, coalesce(p_grace_minutes, 10), coalesce(p_release_queue_on_end, true))
    returning id into v_id;
  else
    update public.access_schedules
       set name = btrim(p_name),
           timezone = p_timezone,
           is_active = coalesce(p_is_active, true),
           intervals = p_intervals,
           warn_before_minutes = p_warn_before_minutes,
           grace_minutes = coalesce(p_grace_minutes, 10),
           release_queue_on_end = coalesce(p_release_queue_on_end, true)
     where id = v_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Regra não encontrada.';
    end if;
    delete from public.access_schedule_targets where schedule_id = v_id;
  end if;

  insert into public.access_schedule_targets (tenant_id, schedule_id, department_id)
  select p_tenant_id, v_id, x from unnest(coalesce(p_department_ids, '{}')) x;

  insert into public.access_schedule_targets (tenant_id, schedule_id, user_id)
  select p_tenant_id, v_id, x from unnest(coalesce(p_user_ids, '{}')) x;

  return v_id;
end;
$$;

revoke all on function public.access_schedule_save(uuid, uuid, text, text, boolean, jsonb, integer, integer, boolean, uuid[], uuid[]) from public, anon;
grant execute on function public.access_schedule_save(uuid, uuid, text, text, boolean, jsonb, integer, integer, boolean, uuid[], uuid[]) to authenticated, service_role;

create or replace function public.access_schedule_set_active(p_id uuid, p_is_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.access_schedules s
     set is_active = p_is_active
   where s.id = p_id
     and (
       coalesce(public.is_super_admin(), false)
       or (coalesce(public.is_tenant_admin(), false) and s.tenant_id = public.current_tenant_id())
     );
  if not found then
    raise exception 'Só o administrador da empresa pode alterar horários de acesso.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.access_schedule_set_active(uuid, boolean) from public, anon;
grant execute on function public.access_schedule_set_active(uuid, boolean) to authenticated, service_role;

create or replace function public.access_schedule_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.access_schedules s
   where s.id = p_id
     and (
       coalesce(public.is_super_admin(), false)
       or (coalesce(public.is_tenant_admin(), false) and s.tenant_id = public.current_tenant_id())
     );
  if not found then
    raise exception 'Só o administrador da empresa pode alterar horários de acesso.' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.access_schedule_delete(uuid) from public, anon;
grant execute on function public.access_schedule_delete(uuid) to authenticated, service_role;

-- As funções internas não são para a tela.
revoke all on function public.fn_access_schedule_window(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.fn_access_schedule_window(uuid, timestamptz) to service_role;
revoke all on function public.fn_access_schedule_intervals_error(jsonb) from public, anon, authenticated;
grant execute on function public.fn_access_schedule_intervals_error(jsonb) to service_role;

-- ─── Catálogo do RBAC: a aba herda a visibilidade da vizinha (Segurança) ────
--
-- Nos 3 degraus (global, por empresa, por grupo). Ver as migrations de
-- 17/09 (`automacoes_rbac_v2_herda_operacao`) para o porquê.

insert into public.resources (key, module, label, description, display_order, hidden, is_navigation, where_it_appears)
select
  'cfg.horario_acesso',
  coalesce((select module from public.resources where key = 'cfg.seguranca'), 'Configurações > Equipe'),
  'Horário de acesso',
  'Em que horários cada setor ou pessoa pode usar o sistema.',
  coalesce((select display_order + 1 from public.resources where key = 'cfg.seguranca'), 700),
  false,
  coalesce((select is_navigation from public.resources where key = 'cfg.seguranca'), false),
  'Configurações > Equipe > Horário de acesso'
on conflict (key) do nothing;

insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select role, 'cfg.horario_acesso', can_view, can_insert, can_update, can_delete
  from public.role_permissions
 where resource_key = 'cfg.seguranca'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, 'cfg.horario_acesso',
       trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
 where trp.resource_key = 'cfg.seguranca'
on conflict (tenant_id, role, resource_key) do nothing;

insert into public.group_permissions
  (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select gp.group_id, 'cfg.horario_acesso',
       gp.can_view, gp.can_insert, gp.can_update, gp.can_delete
  from public.group_permissions gp
 where gp.resource_key = 'cfg.seguranca'
on conflict (group_id, resource_key) do nothing;

commit;

-- ─── Conferência (rodar depois, leitura pura) ───────────────────────────────
--
-- select
--   (select count(*) from pg_policies where schemaname='public'
--      and tablename in ('access_schedules','access_schedule_targets'))          as policies,   -- 2
--   (select count(*) from pg_proc where proname in ('get_my_access_window',
--      'access_schedule_overview','access_schedule_save','access_schedule_set_active',
--      'access_schedule_delete','fn_access_schedule_resolve','fn_access_schedule_window',
--      'fn_access_schedule_intervals_error'))                                     as funcoes,    -- 8
--   (select count(*) from public.resources where key='cfg.horario_acesso')        as resource,   -- 1
--   (select count(*) from public.role_permissions where resource_key='cfg.seguranca')
--     = (select count(*) from public.role_permissions where resource_key='cfg.horario_acesso') as rbac_global_ok,
--   (select count(*) from public.tenant_role_permissions where resource_key='cfg.seguranca')
--     = (select count(*) from public.tenant_role_permissions where resource_key='cfg.horario_acesso') as rbac_empresa_ok,
--   (select count(*) from public.group_permissions where resource_key='cfg.seguranca')
--     = (select count(*) from public.group_permissions where resource_key='cfg.horario_acesso') as rbac_grupo_ok;
