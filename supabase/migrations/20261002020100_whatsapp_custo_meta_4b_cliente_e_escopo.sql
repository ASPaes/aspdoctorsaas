-- =============================================================================
-- Custo do WhatsApp Oficial (Meta) — fase 4b: custo por cliente + escopo por permissão
--
-- 1. _wa_cost_msgs: a classificação passa a morar numa função que devolve UMA
--    linha por mensagem enviada (com o cliente). _wa_cost_rows e o agregado por
--    cliente somam a partir dela — continua havendo uma fonte só de regra.
--    Conferência: refazer whatsapp_cost_daily com a função nova tem que dar o
--    mesmo hash do agregado anterior (54e59472…, 2.079 linhas, 02/10/2026).
--
-- 2. whatsapp_cost_cliente_daily: (tenant, cliente, instância, dia, técnico).
--    Cliente = o do atendimento em curso na hora da mensagem (lookup lateral
--    por opened_at); sem atendimento com cliente, o do contato. 94% das
--    mensagens de setembro tinham cliente. user_id nulo = automação.
--
-- 3. get_whatsapp_cost_dashboard:
--    · escopo completo vem de rbac_pode('painel_uso.custo_whatsapp', {admin});
--    · p_user_id novo = modo Visão 360° do colaborador, com a MESMA regra de
--      quem-vê-quem de get_colaborador_360 (admin todos, head setor, user ele);
--    · devolve medianas do time (sem nomes) e a marca de simulação: antes de
--      01/10/2026 a resposta dentro da janela era grátis, então o valor é
--      "quanto custaria com a regra de hoje".
--    A assinatura muda (5º parâmetro): DROP + CREATE, para não deixar
--    sobrecarga ambígua para o PostgREST.
--
-- 4. get_whatsapp_cost_cliente: sub-aba da Visão 360° do cliente. Exige a
--    mesma permissão.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Uma linha por mensagem enviada, já classificada
-- -----------------------------------------------------------------------------
create or replace function public._wa_cost_msgs(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  tenant_id uuid, instance_id uuid, conversation_id uuid, message_id text, dia date,
  actor_kind text, user_id uuid, automation_type text, cliente_id uuid,
  rajada boolean, vazia boolean, curta boolean, midia boolean, billable boolean, com_pricing boolean
)
language plpgsql
stable
set search_path = public
as $fn$
begin
  -- SQL dinâmico de propósito: com os valores literais o planner usa
  -- idx_wa_msg_created_at (~40 ms/dia); parametrizado ele varria as mensagens
  -- das instâncias Meta inteiras (~520 ms).
  return query execute $q$
with inst as (
  select wi.id, wi.tenant_id from public.whatsapp_instances wi
  where wi.provider_type = 'meta_cloud' and ($1::uuid is null or wi.tenant_id = $1)
),
win as (
  -- 10 min antes do início para o lag da rajada funcionar na virada do dia.
  select wm.tenant_id, wm.instance_id, wm.conversation_id, wm.message_id, wm."timestamp" as ts,
         wm.is_from_me, wm.sent_by_user_id, wm.message_type, wm.content,
         case when jsonb_typeof(wm.metadata) = 'object' then wm.metadata else '{}'::jsonb end as md,
         lag(wm.is_from_me)      over w as prev_from_me,
         lag(wm.sent_by_user_id) over w as prev_user,
         lag(wm."timestamp")     over w as prev_ts
  from public.whatsapp_messages wm
  join inst on inst.id = wm.instance_id
  where wm.created_at >= $2 - interval '15 minutes'
    and wm.created_at <  $3 + interval '1 hour'
    and wm."timestamp" >= $2 - interval '10 minutes'
    and wm."timestamp" <  $3
  window w as (partition by wm.conversation_id order by wm."timestamp", wm.message_id)
),
cls as (
  select w.*, (w.sent_by_user_id is not null and not (w.md ? 'system_message')) as is_tec
  from win w
  where w.is_from_me and w.ts >= $2
),
cls2 as (
  select c.*,
    case when c.is_tec then 'tecnico' else 'automacao' end as actor_kind,
    case when c.is_tec then c.sent_by_user_id end as user_id,
    case
      when c.md ? 'template_name' then 'template'
      when c.is_tec then null
      when c.md ? 'csat_nudge' or c.md ? 'csat_timeout' then 'csat_cutucao'
      when c.md ? 'csat' or c.md ? 'csat_late' then 'csat_agradecimento'
      when c.md ? 'inactivity_close' then 'encerramento_inatividade'
      when c.md ? 'inactivity_warning' or c.md ? 'inactivity_eod' then 'aviso_inatividade'
      when c.md ? 'deferred_after_csat' or c.md ? 'ura_closed' then 'mensagem_encerramento'
      when c.md ? 'ura_invalid' then 'ura_resposta_invalida'
      when c.md ? 'ura_confirmed' then 'ura_confirmacao'
      when c.md ? 'department_closed' or c.md ? 'outside_hours' or c.md ? 'business_hours' then 'fora_horario'
      when c.md ? 'ura' or c.md ? 'department_message' then 'ura_menu'
      when c.md ? 'welcome' then 'boas_vindas'
      when c.md ? 'pause_notice' then 'aviso_pausa'
      when c.md ? 'schedule_reminder' then 'lembrete_agendamento'
      when c.md ? 'system_message' and c.sent_by_user_id is not null then
        case when c.content ~* 'atendimento.{0,20}encerrad' then 'mensagem_encerramento' else 'csat_pergunta' end
      when c.md ? 'attendance_event' or c.md ? 'system_message' or c.md ? 'system' then 'evento_sistema'
      when c.md ? 'auto' then 'auto_outros'
      else 'nao_classificado'
    end as automation_type
  from cls c
)
select c.tenant_id, c.instance_id, c.conversation_id, c.message_id,
       (c.ts at time zone 'America/Sao_Paulo')::date,
       c.actor_kind, c.user_id, c.automation_type,
       coalesce(sa.cliente_id, ct.cliente_id),
       coalesce(c.is_tec and c.automation_type is null
                and c.prev_from_me and c.prev_user = c.sent_by_user_id
                and c.ts - c.prev_ts <= interval '60 seconds', false),
       coalesce(c.message_type = 'text' and c.content ~* E'^\\s*(ok|okay|certo|entendi|blz|beleza|perfeito|show|isso|sim|não|nao|um momento|só um momento|aguarde|obrigad[oa]|de nada|bom dia|boa tarde|boa noite|olá|ola|oi)[\\s!.,\\U0001F60A\\U0001F642\\U0001F44D]*$', false),
       coalesce(c.message_type = 'text' and length(c.content) <= 25, false),
       coalesce(c.message_type in ('image','video','audio','document','sticker'), false),
       coalesce(p.billable, false),
       (p.message_id is not null)
from cls2 c
left join public.whatsapp_message_pricing p on p.tenant_id = c.tenant_id and p.message_id = c.message_id
left join public.whatsapp_conversations wc on wc.id = c.conversation_id
left join public.whatsapp_contacts ct on ct.id = wc.contact_id
left join lateral (
  select s.cliente_id from public.support_attendances s
  where s.conversation_id = c.conversation_id and s.opened_at <= c.ts and s.cliente_id is not null
  order by s.opened_at desc limit 1
) sa on true
$q$ using p_tenant, p_from, p_to;
end
$fn$;

revoke all on function public._wa_cost_msgs(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- _wa_cost_rows passa a somar a partir de _wa_cost_msgs (mesma saída de antes)
-- -----------------------------------------------------------------------------
create or replace function public._wa_cost_rows(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  tenant_id uuid, instance_id uuid, dia date, actor_kind text, user_id uuid, automation_type text,
  enviadas integer, cobradas integer, com_pricing integer, rajadas integer, vazias integer,
  curtas integer, midias integer, conversas integer, atendimentos integer
)
language plpgsql
stable
set search_path = public
as $fn$
#variable_conflict use_column
begin
  return query
  with m as (
    select * from public._wa_cost_msgs(p_tenant, p_from, p_to)
  ),
  agg as (
    select m.tenant_id, m.instance_id, m.dia, m.actor_kind, m.user_id, m.automation_type,
           count(*)::int as enviadas,
           count(*) filter (where m.billable)::int as cobradas,
           count(*) filter (where m.com_pricing)::int as com_pricing,
           count(*) filter (where m.rajada)::int as rajadas,
           count(*) filter (where m.vazia)::int as vazias,
           count(*) filter (where m.curta)::int as curtas,
           count(*) filter (where m.midia)::int as midias,
           count(distinct m.conversation_id)::int as conversas
    from m
    group by 1,2,3,4,5,6
  ),
  att as (
    select sa.tenant_id, sa.instance_id,
           (sa.closed_at at time zone 'America/Sao_Paulo')::date as dia,
           sa.assigned_to as user_id, count(*)::int as atendimentos
    from public.support_attendances sa
    join public.whatsapp_instances wi
      on wi.id = sa.instance_id and wi.provider_type = 'meta_cloud'
     and (p_tenant is null or wi.tenant_id = p_tenant)
    where sa.closed_at >= p_from and sa.closed_at < p_to and sa.assigned_to is not null
    group by 1,2,3,4
  ),
  tc as (
    select * from agg where agg.actor_kind = 'tecnico' and agg.automation_type is null
  )
  select coalesce(a.tenant_id, t.tenant_id), coalesce(a.instance_id, t.instance_id),
         coalesce(a.dia, t.dia), 'tecnico'::text,
         coalesce(a.user_id, t.user_id), null::text,
         coalesce(a.enviadas,0), coalesce(a.cobradas,0), coalesce(a.com_pricing,0),
         coalesce(a.rajadas,0), coalesce(a.vazias,0), coalesce(a.curtas,0),
         coalesce(a.midias,0), coalesce(a.conversas,0), coalesce(t.atendimentos,0)
  from tc a
  full join att t
    on t.tenant_id = a.tenant_id and t.instance_id = a.instance_id
   and t.dia = a.dia and t.user_id = a.user_id
  union all
  select g.tenant_id, g.instance_id, g.dia, g.actor_kind, g.user_id, g.automation_type,
         g.enviadas, g.cobradas, g.com_pricing, g.rajadas, g.vazias, g.curtas, g.midias, g.conversas, 0
  from agg g where not (g.actor_kind = 'tecnico' and g.automation_type is null);
end
$fn$;

revoke all on function public._wa_cost_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Agregado por cliente
-- -----------------------------------------------------------------------------
create table if not exists public.whatsapp_cost_cliente_daily (
  tenant_id    uuid    not null references public.tenants(id) on delete cascade,
  cliente_id   uuid,               -- nulo = mensagem sem cliente identificado
  instance_id  uuid    not null,   -- sem FK: o histórico sobrevive à exclusão do canal
  dia          date    not null,   -- dia em America/Sao_Paulo
  user_id      uuid,               -- técnico; nulo = automação
  enviadas     integer not null default 0,
  rajadas      integer not null default 0,
  templates    integer not null default 0,
  cobradas     integer not null default 0,
  com_pricing  integer not null default 0,
  updated_at   timestamptz not null default now()
);
create unique index if not exists uq_whatsapp_cost_cliente_daily
  on public.whatsapp_cost_cliente_daily (tenant_id, cliente_id, instance_id, dia, user_id)
  nulls not distinct;
create index if not exists idx_whatsapp_cost_cliente_daily_tenant_dia
  on public.whatsapp_cost_cliente_daily (tenant_id, dia);

alter table public.whatsapp_cost_cliente_daily enable row level security;
drop policy if exists wccd_select on public.whatsapp_cost_cliente_daily;
create policy wccd_select on public.whatsapp_cost_cliente_daily
  for select to authenticated
  using ((tenant_id = public.current_tenant_id() and public.is_admin_or_head()) or public.is_super_admin());

revoke all on public.whatsapp_cost_cliente_daily from public, anon, authenticated;
grant select on public.whatsapp_cost_cliente_daily to authenticated;
grant all on public.whatsapp_cost_cliente_daily to service_role;

create or replace function public._wa_cost_cliente_rows(p_tenant uuid, p_from timestamptz, p_to timestamptz)
returns table (
  tenant_id uuid, cliente_id uuid, instance_id uuid, dia date, user_id uuid,
  enviadas integer, rajadas integer, templates integer, cobradas integer, com_pricing integer
)
language plpgsql
stable
set search_path = public
as $fn$
#variable_conflict use_column
begin
  return query
  select m.tenant_id, m.cliente_id, m.instance_id, m.dia,
         case when m.actor_kind = 'tecnico' then m.user_id end,
         count(*)::int,
         count(*) filter (where m.rajada)::int,
         count(*) filter (where m.automation_type = 'template')::int,
         count(*) filter (where m.billable)::int,
         count(*) filter (where m.com_pricing)::int
  from public._wa_cost_msgs(p_tenant, p_from, p_to) m
  group by 1, 2, 3, 4, 5;
end
$fn$;

revoke all on function public._wa_cost_cliente_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Refresh dos dois agregados (delete + insert por dia)
-- -----------------------------------------------------------------------------
create or replace function public.refresh_whatsapp_cost_daily(p_from date, p_to date)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  d date;
  k integer;
  n integer := 0;
  t0 timestamptz;
  t1 timestamptz;
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'refresh_whatsapp_cost_daily: periodo invalido (% a %)', p_from, p_to;
  end if;
  if p_to - p_from > 400 then
    raise exception 'refresh_whatsapp_cost_daily: periodo maior que 400 dias';
  end if;

  d := p_from;
  while d <= p_to loop
    t0 := d::timestamp at time zone 'America/Sao_Paulo';
    t1 := (d + 1)::timestamp at time zone 'America/Sao_Paulo';

    delete from public.whatsapp_cost_daily where dia = d;
    insert into public.whatsapp_cost_daily (
      tenant_id, instance_id, dia, actor_kind, user_id, automation_type,
      enviadas, cobradas, com_pricing, rajadas, vazias, curtas, midias, conversas, atendimentos
    )
    select r.tenant_id, r.instance_id, r.dia, r.actor_kind, r.user_id, r.automation_type,
           r.enviadas, r.cobradas, r.com_pricing, r.rajadas, r.vazias, r.curtas, r.midias, r.conversas, r.atendimentos
    from public._wa_cost_rows(null, t0, t1) r;
    get diagnostics k = row_count;
    n := n + k;

    delete from public.whatsapp_cost_cliente_daily where dia = d;
    insert into public.whatsapp_cost_cliente_daily (
      tenant_id, cliente_id, instance_id, dia, user_id, enviadas, rajadas, templates, cobradas, com_pricing
    )
    select c.tenant_id, c.cliente_id, c.instance_id, c.dia, c.user_id,
           c.enviadas, c.rajadas, c.templates, c.cobradas, c.com_pricing
    from public._wa_cost_cliente_rows(null, t0, t1) c;

    d := d + 1;
  end loop;
  return n;
end
$fn$;

revoke all on function public.refresh_whatsapp_cost_daily(date, date) from public, anon, authenticated;
grant execute on function public.refresh_whatsapp_cost_daily(date, date) to service_role;

-- -----------------------------------------------------------------------------
-- 3. RPC do painel e da Visão 360° do colaborador
-- -----------------------------------------------------------------------------
drop function if exists public.get_whatsapp_cost_dashboard(uuid, date, date, uuid);

create or replace function public.get_whatsapp_cost_dashboard(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_instance_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_role      text;
  v_sa        boolean;
  v_full      boolean;
  v_alvo      uuid;
  v_escopo    text;
  v_now_sp    timestamp := now() at time zone 'America/Sao_Paulo';
  v_today     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_regra     date := date '2026-10-01';  -- a Meta passou a cobrar a resposta na janela
  v_live_from date;
  v_to        date;
  v_m0        date;
  v_price     numeric;
  v_franq     integer;
  v_result    jsonb;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = '42501';
  end if;
  select p.tenant_id, p.role, coalesce(p.is_super_admin, false)
    into v_tenant, v_role, v_sa
  from public.profiles p where p.user_id = v_uid;
  if not found then
    raise exception 'perfil nao encontrado' using errcode = '42501';
  end if;
  if p_tenant_id is null then
    raise exception 'empresa obrigatoria' using errcode = '22023';
  end if;
  if not v_sa and p_tenant_id is distinct from v_tenant then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'periodo invalido' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'periodo maior que 400 dias' using errcode = '22023';
  end if;

  if p_user_id is null then
    -- Painel de Uso: empresa inteira só com a permissão; sem ela, só o próprio.
    v_full := v_sa or public.rbac_pode('painel_uso.custo_whatsapp', array['admin']);
    v_alvo := v_uid;
  else
    -- Visão 360° do colaborador: mesma regra de get_colaborador_360.
    v_escopo := case when v_sa or v_role = 'admin' then 'todos'
                     when v_role = 'head' then 'setor'
                     else 'proprio' end;
    if p_user_id <> v_uid then
      if v_escopo = 'proprio' then
        raise exception 'Sem permissão para ver este colaborador' using errcode = '42501';
      elsif v_escopo = 'setor' and not exists (
        select 1 from public.support_department_members m
        where m.tenant_id = p_tenant_id and m.user_id = p_user_id and coalesce(m.is_active, true)
          and m.department_id in (
            select m2.department_id from public.support_department_members m2
            where m2.user_id = v_uid and m2.tenant_id = p_tenant_id and coalesce(m2.is_active, true))
      ) then
        raise exception 'Sem permissão para ver este colaborador' using errcode = '42501';
      end if;
    end if;
    if not exists (select 1 from public.profiles p where p.user_id = p_user_id and p.tenant_id = p_tenant_id) then
      raise exception 'Sem permissão para ver este colaborador' using errcode = '42501';
    end if;
    v_full := false;
    v_alvo := p_user_id;
  end if;

  v_to := least(p_to, v_today);
  v_m0 := least(date_trunc('month', p_from)::date, date_trunc('month', v_today)::date);
  v_live_from := case when v_now_sp::time < time '00:30' then v_today - 1 else v_today end;

  select c.meta_price_per_message_brl, c.meta_free_messages_per_number
    into v_price, v_franq
  from public.configuracoes c where c.tenant_id = p_tenant_id;
  v_price := coalesce(v_price, 0.035);
  v_franq := coalesce(v_franq, 1000);

  with
  r0 as (
    select d.instance_id, d.dia, d.actor_kind, d.user_id, d.automation_type,
           d.enviadas, d.cobradas, d.com_pricing, d.rajadas, d.vazias, d.curtas, d.conversas, d.atendimentos
    from public.whatsapp_cost_daily d
    where d.tenant_id = p_tenant_id
      and d.dia >= v_m0 and d.dia < v_live_from
      and (p_instance_id is null or d.instance_id = p_instance_id)
    union all
    select x.instance_id, x.dia, x.actor_kind, x.user_id, x.automation_type,
           x.enviadas, x.cobradas, x.com_pricing, x.rajadas, x.vazias, x.curtas, x.conversas, x.atendimentos
    from public._wa_cost_rows(p_tenant_id, v_live_from::timestamp at time zone 'America/Sao_Paulo', now()) x
    where (p_instance_id is null or x.instance_id = p_instance_id)
  ),
  inst_day as (
    select instance_id, dia, sum(enviadas) as env,
           sum(sum(enviadas)) over (partition by instance_id, date_trunc('month', dia) order by dia) as cum
    from r0 group by instance_id, dia
  ),
  inst_day_est as (
    select instance_id, dia, env,
           greatest(0, cum - v_franq) - greatest(0, cum - env - v_franq) as excedente
    from inst_day
  ),
  r as (
    select r0.*,
           (r0.dia between p_from and v_to) as no_periodo,
           (date_trunc('month', r0.dia) = date_trunc('month', v_today)) as no_mes_atual,
           case when e.env > 0 then r0.enviadas::numeric * e.excedente / e.env else 0 end as cobradas_est
    from r0 join inst_day_est e using (instance_id, dia)
  ),
  s as (
    select * from r where v_full or (actor_kind = 'tecnico' and user_id = v_alvo)
  ),
  f as (
    select t.*, case when t.env > 0 and t.cp >= 0.9 * t.env then 'real' else 'estimado' end as fonte
    from (
      select coalesce(sum(enviadas), 0) as env, coalesce(sum(cobradas), 0) as cob,
             coalesce(sum(com_pricing), 0) as cp, coalesce(sum(cobradas_est), 0) as est
      from s where no_periodo
    ) t
  ),
  -- Projeção do mês corrente. Real: cobradas ÷ dias decorridos × dias do mês.
  -- Estimado: projeta o VOLUME de cada número e só então desconta a franquia.
  dd as (
    select extract(day from v_today)::numeric as d,
           extract(day from (date_trunc('month', v_today) + interval '1 month - 1 day'))::numeric as dm
  ),
  fm as (
    select case
             when t.env > 0 and t.cp >= 0.9 * t.env then t.cob::numeric / dd.d * dd.dm
             else coalesce((
                    select sum(greatest(0, ie.env::numeric / dd.d * dd.dm - v_franq))
                    from (select instance_id, sum(enviadas) as env from r where no_mes_atual group by instance_id) ie
                  ), 0)
                  * case when tt.env > 0 then t.env::numeric / tt.env else 0 end
           end as cob_proj
    from (
      select coalesce(sum(enviadas), 0) as env, coalesce(sum(cobradas), 0) as cob,
             coalesce(sum(com_pricing), 0) as cp
      from s where no_mes_atual
    ) t,
    (select coalesce(sum(enviadas), 0) as env from r where no_mes_atual) tt,
    dd
  ),
  sc as (
    select s.*,
           (case when f.fonte = 'real' then s.cobradas::numeric else s.cobradas_est end) as cob_fonte,
           (case when f.fonte = 'real' then s.cobradas::numeric else s.cobradas_est end) * v_price as custo
    from s, f where s.no_periodo
  ),
  orig as (
    select 'tecnico_conteudo'::text as origem,
           coalesce(sum(enviadas - rajadas), 0) as qtd,
           coalesce(sum(custo * (enviadas - rajadas)::numeric / nullif(enviadas, 0)), 0) as custo
    from sc where actor_kind = 'tecnico' and automation_type is null
    union all
    select 'tecnico_rajada', coalesce(sum(rajadas), 0),
           coalesce(sum(custo * rajadas::numeric / nullif(enviadas, 0)), 0)
    from sc where actor_kind = 'tecnico' and automation_type is null
    union all
    select case when actor_kind = 'tecnico' then 'tecnico_' || automation_type else automation_type end,
           sum(enviadas), sum(custo)
    from sc where automation_type is not null
    group by 1
  ),
  auto_tot as (
    select coalesce(sum(enviadas) filter (where actor_kind = 'automacao'), 0) as auto_env,
           coalesce(sum(enviadas) filter (where automation_type = 'ura_resposta_invalida'), 0) as ura_inv,
           coalesce(sum(enviadas) filter (where automation_type = 'csat_cutucao'), 0) as csat_cut,
           coalesce(sum(enviadas) filter (where automation_type = 'ura_confirmacao'), 0) as ura_conf,
           coalesce(sum(enviadas) filter (where automation_type = 'aviso_inatividade'), 0) as aviso_inat,
           coalesce(sum(enviadas) filter (where automation_type = 'encerramento_inatividade'), 0) as enc_inat,
           coalesce(sum(rajadas), 0) as raj
    from sc
  ),
  -- Time inteiro (sem nomes): base das medianas e da posição
  tec_all as (
    select user_id, sum(enviadas) as env, sum(atendimentos) as att,
           sum(rajadas) as raj, sum(vazias) as vaz
    from r
    where no_periodo and actor_kind = 'tecnico' and automation_type is null and user_id is not null
    group by user_id
  ),
  med as (
    select
      (percentile_cont(0.5) within group (order by env::numeric / att))::numeric as med,
      (percentile_cont(0.5) within group (order by raj::numeric / nullif(env, 0)))::numeric as med_raj,
      (percentile_cont(0.5) within group (order by vaz::numeric / nullif(env, 0)))::numeric as med_vaz,
      (percentile_cont(0.5) within group (order by env))::numeric as med_env,
      count(*) as n
    from tec_all
    where att >= 5
  ),
  pos as (
    select user_id, rank() over (order by env desc) as posicao, count(*) over () as n
    from tec_all where env > 0
  ),
  tec as (
    select user_id,
           sum(enviadas) as env, sum(atendimentos) as att, sum(rajadas) as raj,
           sum(vazias) as vaz, sum(curtas) as cur, sum(conversas) as conv, sum(custo) as custo
    from sc
    where actor_kind = 'tecnico' and automation_type is null and user_id is not null
    group by user_id
  ),
  tec2 as (
    select t.*,
           case when t.att > 0 then round(t.env::numeric / t.att, 1) end as mpa,
           case when t.env > 0 then t.raj::numeric / t.env else 0 end as pct_raj,
           case when t.env > 0 then t.vaz::numeric / t.env else 0 end as pct_vaz,
           (select med from med) as med,
           coalesce(fu.nome, 'Usuário removido') as nome
    from tec t
    left join public.profiles p on p.user_id = t.user_id
    left join public.funcionarios fu on fu.id = p.funcionario_id
  ),
  dias as (
    select g::date as dia from generate_series(p_from::timestamp, v_to::timestamp, interval '1 day') g
  ),
  por_dia as (
    select d.dia,
           coalesce(sum(sc.enviadas), 0) as env,
           coalesce(sum(sc.cob_fonte), 0) as cob,
           coalesce(sum(sc.custo), 0) as custo
    from dias d left join sc on sc.dia = d.dia
    group by d.dia
  ),
  inst_mes as (
    select wi.id, coalesce(nullif(wi.display_name, ''), wi.instance_name) as nome, wi.status,
           coalesce(wi.is_active, true) as ativa,
           coalesce(sum(r.enviadas), 0) as env,
           coalesce(sum(r.cobradas), 0) as cob_real,
           coalesce(sum(r.com_pricing), 0) as cp,
           coalesce(sum(r.cobradas_est), 0) as cob_est
    from public.whatsapp_instances wi
    left join r on r.instance_id = wi.id and r.no_mes_atual
    where wi.tenant_id = p_tenant_id and wi.provider_type = 'meta_cloud'
      and (p_instance_id is null or wi.id = p_instance_id)
    group by wi.id, wi.display_name, wi.instance_name, wi.status, wi.is_active
  )
  select jsonb_build_object(
    'escopo', case when v_full then 'completo' else 'proprio' end,
    'periodo', jsonb_build_object('de', p_from, 'ate', v_to, 'inclui_hoje', p_to >= v_today),
    'simulacao', case when p_from < v_regra then jsonb_build_object(
                   'regra_desde', v_regra, 'periodo_todo', v_to < v_regra) end,
    'gerado_em', now(),
    'resumo', (
      select jsonb_build_object(
        'enviadas', f.env,
        'cobradas_reais', f.cob,
        'com_pricing', f.cp,
        'cobertura_pricing_pct', case when f.env > 0 then round(100.0 * f.cp / f.env, 1) else 0 end,
        'fonte', f.fonte,
        'preco_unitario', v_price,
        'franquia_por_numero', v_franq,
        'numeros_meta', (select count(*) from public.whatsapp_instances wi
                          where wi.tenant_id = p_tenant_id and wi.provider_type = 'meta_cloud'
                            and coalesce(wi.is_active, true)),
        'custo_rs', round(coalesce((select sum(custo) from sc), 0), 2),
        'projecao_mes_rs', round((select cob_proj from fm) * v_price, 2),
        'evitavel_rs', round(
            (case when v_full then a.raj + a.ura_inv + a.csat_cut + a.ura_conf else a.raj end) * v_price, 2)
      )
      from f, auto_tot a
    ),
    'mediana_time_msgs_por_atendimento', (select round(med, 1) from med),
    'time', (select jsonb_build_object(
               'n', m.n,
               'msgs_por_atendimento', round(m.med, 1),
               'pct_rajada', round(100 * m.med_raj, 1),
               'pct_vazias', round(100 * m.med_vaz, 1),
               'enviadas', round(m.med_env)) from med m),
    'posicao_enviadas', case when v_full then null else (
      select jsonb_build_object('posicao', p.posicao, 'de', p.n) from pos p where p.user_id = v_alvo) end,
    'por_origem', coalesce((
      select jsonb_agg(jsonb_build_object(
               'origem', o.origem,
               'qtd', o.qtd,
               'pct', case when (select env from f) > 0 then round(100.0 * o.qtd / (select env from f), 1) else 0 end,
               'custo_rs', round(o.custo, 2)
             ) order by o.qtd desc)
      from orig o where o.qtd > 0
    ), '[]'::jsonb),
    'por_tecnico', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', t.user_id,
               'nome', t.nome,
               'enviadas', t.env,
               'atendimentos', t.att,
               'conversas', t.conv,
               'msgs_por_atendimento', t.mpa,
               'pct_rajada', round(100 * t.pct_raj, 1),
               'pct_vazias', round(100 * t.pct_vaz, 1),
               'rajadas', t.raj,
               'vazias', t.vaz,
               'custo_rs', round(t.custo, 2),
               'evitavel_rs', round(t.raj * v_price, 2),
               'sugestoes', (
                 select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb)
                 from (values
                   (case when t.pct_raj > 0.30 then jsonb_build_object(
                      'codigo', 'rajada',
                      'severidade', case when t.pct_raj > 0.45 then 'alta' else 'media' end,
                      'texto', 'Junte saudação, pergunta e explicação numa mensagem só (Shift+Enter quebra linha).',
                      'economia_rs', round(t.raj * v_price, 2)) end),
                   (case when t.pct_vaz > 0.05 then jsonb_build_object(
                      'codigo', 'vazias',
                      'severidade', 'media',
                      'texto', 'Evite mensagens só com ''ok'', ''entendi'', ''um momento'': junte com a próxima informação.',
                      'economia_rs', round(t.vaz * v_price, 2)) end),
                   (case when t.att >= 10 and t.med > 0 and t.env::numeric / t.att > 1.5 * t.med then jsonb_build_object(
                      'codigo', 'atendimento_longo',
                      'severidade', 'media',
                      'texto', 'Atendimentos mais longos que o time: revise a condução e use macros completas.',
                      'economia_rs', round(greatest(0, t.env - t.med * t.att) * v_price, 2)) end)
                 ) v(x)
               )
             ) order by t.custo desc, t.env desc)
      from tec2 t
    ), '[]'::jsonb),
    'por_instancia', case when not v_full then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'instance_id', i.id,
               'nome', i.nome,
               'status', i.status,
               'ativa', i.ativa,
               'enviadas_mes', i.env,
               'cobradas_mes', case when i.env > 0 and i.cp >= 0.9 * i.env then i.cob_real else round(i.cob_est) end,
               'fonte', case when i.env > 0 and i.cp >= 0.9 * i.env then 'real' else 'estimado' end,
               'franquia', v_franq,
               'uso_franquia_pct', case when v_franq > 0 then round(100.0 * i.env / v_franq, 1) else null end
             ) order by i.env desc)
      from inst_mes i
    ), '[]'::jsonb) end,
    'por_dia', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dia', d.dia, 'enviadas', d.env, 'cobradas', round(d.cob), 'custo_rs', round(d.custo, 2)
             ) order by d.dia)
      from por_dia d
    ), '[]'::jsonb),
    'sugestoes_gerais', case when not v_full then '[]'::jsonb else (
      select coalesce(jsonb_agg(x) filter (where x is not null), '[]'::jsonb)
      from auto_tot a, lateral (values
        (case when a.auto_env > 0 and a.ura_inv > 0.02 * a.auto_env then jsonb_build_object(
           'codigo', 'ura_botoes', 'severidade', 'media',
           'texto', 'Troque o menu numérico por botões.',
           'economia_rs', round(a.ura_inv * v_price, 2)) end),
        (case when a.csat_cut > 0 then jsonb_build_object(
           'codigo', 'csat_lembretes', 'severidade', 'media',
           'texto', 'Desative os lembretes do CSAT.',
           'economia_rs', round(a.csat_cut * v_price, 2)) end),
        (case when a.aviso_inat > 0 and a.enc_inat > 0 then jsonb_build_object(
           'codigo', 'inatividade_dupla', 'severidade', 'baixa',
           'texto', 'Use só o encerramento ou só o aviso de inatividade.',
           'economia_rs', round(least(a.aviso_inat, a.enc_inat) * v_price, 2)) end),
        (case when a.ura_conf > 0 then jsonb_build_object(
           'codigo', 'ura_confirmacao', 'severidade', 'baixa',
           'texto', 'A confirmação ''Você escolheu…'' pode ser dispensada.',
           'economia_rs', round(a.ura_conf * v_price, 2)) end)
      ) v(x)
    ) end
  )
  into v_result;

  return v_result;
end
$fn$;

revoke all on function public.get_whatsapp_cost_dashboard(uuid, date, date, uuid, uuid) from public, anon;
grant execute on function public.get_whatsapp_cost_dashboard(uuid, date, date, uuid, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. RPC da sub-aba "WhatsApp Oficial" da Visão 360° do cliente
-- -----------------------------------------------------------------------------
create or replace function public.get_whatsapp_cost_cliente(
  p_cliente_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_uid       uuid := auth.uid();
  v_tenant    uuid;
  v_my_tenant uuid;
  v_sa        boolean;
  v_now_sp    timestamp := now() at time zone 'America/Sao_Paulo';
  v_today     date := (now() at time zone 'America/Sao_Paulo')::date;
  v_regra     date := date '2026-10-01';
  v_live_from date;
  v_from      date;
  v_to        date;
  v_price     numeric;
  v_franq     integer;
  v_result    jsonb;
begin
  if v_uid is null then
    raise exception 'nao autenticado' using errcode = '42501';
  end if;
  select p.tenant_id, coalesce(p.is_super_admin, false) into v_my_tenant, v_sa
  from public.profiles p where p.user_id = v_uid;
  select c.tenant_id into v_tenant from public.clientes c where c.id = p_cliente_id;
  if v_tenant is null then
    raise exception 'cliente nao encontrado' using errcode = '42501';
  end if;
  if not v_sa and v_tenant is distinct from v_my_tenant then
    raise exception 'acesso negado' using errcode = '42501';
  end if;
  if not public.rbac_pode('painel_uso.custo_whatsapp', array['admin']) then
    raise exception 'sem permissao para ver custo do WhatsApp Oficial' using errcode = '42501';
  end if;

  -- "Todo o período" da 360° chega sem data: começa no primeiro dia com dado.
  v_from := coalesce(p_from, (select min(dia) from public.whatsapp_cost_cliente_daily where tenant_id = v_tenant), v_today);
  v_to := least(coalesce(p_to, v_today), v_today);
  if v_to < v_from then
    raise exception 'periodo invalido' using errcode = '22023';
  end if;
  v_live_from := case when v_now_sp::time < time '00:30' then v_today - 1 else v_today end;

  select c.meta_price_per_message_brl, c.meta_free_messages_per_number
    into v_price, v_franq
  from public.configuracoes c where c.tenant_id = v_tenant;
  v_price := coalesce(v_price, 0.035);
  v_franq := coalesce(v_franq, 1000);

  with
  live as (
    select * from public._wa_cost_cliente_rows(
      v_tenant, v_live_from::timestamp at time zone 'America/Sao_Paulo', now())
    where v_to >= v_live_from
  ),
  live_inst as (
    select x.instance_id, x.dia, sum(x.enviadas) as env
    from public._wa_cost_rows(v_tenant, v_live_from::timestamp at time zone 'America/Sao_Paulo', now()) x
    where v_to >= v_live_from
    group by 1, 2
  ),
  -- linhas deste cliente
  c0 as (
    select d.instance_id, d.dia, d.user_id, d.enviadas, d.rajadas, d.templates, d.cobradas, d.com_pricing
    from public.whatsapp_cost_cliente_daily d
    where d.tenant_id = v_tenant and d.cliente_id = p_cliente_id
      and d.dia between v_from and least(v_to, v_live_from - 1)
    union all
    select l.instance_id, l.dia, l.user_id, l.enviadas, l.rajadas, l.templates, l.cobradas, l.com_pricing
    from live l where l.cliente_id = p_cliente_id
  ),
  -- franquia: total da empresa por número e dia, para ratear o excedente
  inst_day as (
    select instance_id, dia, sum(env) as env from (
      select d.instance_id, d.dia, d.enviadas as env
      from public.whatsapp_cost_daily d
      where d.tenant_id = v_tenant
        and d.dia >= date_trunc('month', v_from)::date and d.dia < v_live_from and d.dia <= v_to
      union all
      select li.instance_id, li.dia, li.env from live_inst li
    ) u group by 1, 2
  ),
  inst_est as (
    select instance_id, dia, env,
           greatest(0, cum - v_franq) - greatest(0, cum - env - v_franq) as excedente
    from (select *, sum(env) over (partition by instance_id, date_trunc('month', dia) order by dia) as cum
          from inst_day) x
  ),
  c1 as (
    select c0.*, case when e.env > 0 then c0.enviadas::numeric * e.excedente / e.env else 0 end as cob_est
    from c0 left join inst_est e using (instance_id, dia)
  ),
  f as (
    select t.*, case when t.env > 0 and t.cp >= 0.9 * t.env then 'real' else 'estimado' end as fonte
    from (select coalesce(sum(enviadas), 0) as env, coalesce(sum(com_pricing), 0) as cp from c1) t
  ),
  c2 as (
    select c1.*, (case when f.fonte = 'real' then c1.cobradas::numeric else c1.cob_est end) * v_price as custo
    from c1, f
  ),
  att as (
    select count(*) as n
    from public.support_attendances sa
    join public.whatsapp_instances wi on wi.id = sa.instance_id and wi.provider_type = 'meta_cloud'
    where sa.tenant_id = v_tenant and sa.cliente_id = p_cliente_id
      and sa.opened_at >= v_from::timestamp at time zone 'America/Sao_Paulo'
      and sa.opened_at <  (v_to + 1)::timestamp at time zone 'America/Sao_Paulo'
  ),
  -- comparação com os outros clientes da empresa (só dias já fechados)
  cli_env as (
    select d.cliente_id, sum(d.enviadas) as env
    from public.whatsapp_cost_cliente_daily d
    where d.tenant_id = v_tenant and d.cliente_id is not null and d.dia between v_from and v_to
    group by 1
  ),
  cli_att as (
    select sa.cliente_id, count(*) as att
    from public.support_attendances sa
    join public.whatsapp_instances wi on wi.id = sa.instance_id and wi.provider_type = 'meta_cloud'
    where sa.tenant_id = v_tenant and sa.cliente_id is not null
      and sa.opened_at >= v_from::timestamp at time zone 'America/Sao_Paulo'
      and sa.opened_at <  (v_to + 1)::timestamp at time zone 'America/Sao_Paulo'
    group by 1
  ),
  cmp as (
    select
      (select (percentile_cont(0.5) within group (order by e.env::numeric / a.att))::numeric
         from cli_env e join cli_att a using (cliente_id) where a.att >= 1) as med_mpa,
      (select count(*) from cli_env where env > 0) as n_clientes,
      (select count(*) + 1 from cli_env e
        where e.env > coalesce((select env from cli_env where cliente_id = p_cliente_id), 0)) as posicao
  ),
  tot as (
    select coalesce(sum(enviadas), 0) as env,
           coalesce(sum(enviadas) filter (where user_id is not null), 0) as tec,
           coalesce(sum(rajadas), 0) as raj,
           coalesce(sum(templates), 0) as tpl,
           coalesce(sum(custo), 0) as custo
    from c2
  ),
  orig as (
    select 'tecnico_conteudo'::text as origem,
           coalesce(sum(enviadas - rajadas - templates) filter (where user_id is not null), 0) as qtd,
           coalesce(sum(custo * (enviadas - rajadas - templates)::numeric / nullif(enviadas, 0)) filter (where user_id is not null), 0) as custo
    from c2
    union all
    select 'tecnico_rajada', coalesce(sum(rajadas), 0),
           coalesce(sum(custo * rajadas::numeric / nullif(enviadas, 0)), 0)
    from c2 where user_id is not null
    union all
    select 'tecnico_template', coalesce(sum(templates), 0),
           coalesce(sum(custo * templates::numeric / nullif(enviadas, 0)), 0)
    from c2 where user_id is not null
    union all
    select 'automaticas', coalesce(sum(enviadas), 0), coalesce(sum(custo), 0)
    from c2 where user_id is null
  ),
  tec as (
    select c2.user_id, sum(c2.enviadas) as env, coalesce(fu.nome, 'Usuário removido') as nome
    from c2
    left join public.profiles p on p.user_id = c2.user_id
    left join public.funcionarios fu on fu.id = p.funcionario_id
    where c2.user_id is not null
    group by c2.user_id, fu.nome
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('de', v_from, 'ate', v_to),
    'simulacao', case when v_from < v_regra then jsonb_build_object(
                   'regra_desde', v_regra, 'periodo_todo', v_to < v_regra) end,
    'resumo', (
      select jsonb_build_object(
        'enviadas', t.env,
        'digitadas', t.tec - t.tpl,
        'rajadas', t.raj,
        'pct_rajada', case when t.tec - t.tpl > 0 then round(100.0 * t.raj / (t.tec - t.tpl), 1) else 0 end,
        'economia_rajada_rs', round(t.raj * v_price, 2),
        'custo_rs', round(t.custo, 2),
        'fonte', f.fonte,
        'preco_unitario', v_price,
        'atendimentos', a.n,
        'custo_por_atendimento', case when a.n > 0 then round(t.custo / a.n, 2) end,
        'msgs_por_atendimento', case when a.n > 0 then round(t.env::numeric / a.n, 1) end,
        'mediana_clientes_msgs_por_atendimento', round(m.med_mpa, 1),
        'posicao_enviadas', case when t.env > 0 then m.posicao end,
        'n_clientes', m.n_clientes
      )
      from tot t, f, att a, cmp m
    ),
    'por_origem', coalesce((
      select jsonb_agg(jsonb_build_object(
               'origem', o.origem, 'qtd', o.qtd,
               'pct', case when (select env from tot) > 0 then round(100.0 * o.qtd / (select env from tot), 1) else 0 end,
               'custo_rs', round(o.custo, 2)
             ) order by o.qtd desc)
      from orig o where o.qtd > 0
    ), '[]'::jsonb),
    'por_tecnico', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', t.user_id, 'nome', t.nome, 'enviadas', t.env,
               'pct', case when (select tec from tot) > 0 then round(100.0 * t.env / (select tec from tot), 1) else 0 end
             ) order by t.env desc)
      from tec t
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end
$fn$;

revoke all on function public.get_whatsapp_cost_cliente(uuid, date, date) from public, anon;
grant execute on function public.get_whatsapp_cost_cliente(uuid, date, date) to authenticated, service_role;
