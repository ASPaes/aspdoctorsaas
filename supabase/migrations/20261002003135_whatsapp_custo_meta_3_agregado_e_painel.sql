-- =============================================================================
-- Custo do WhatsApp Oficial (Meta) — fase 3: agregado diário + RPC do painel
--
-- whatsapp_cost_daily: 1 linha por (tenant, instância, dia SP, ator, usuário,
-- tipo de automação). O painel lê daqui; só o dia de hoje é calculado ao vivo.
--
-- _wa_cost_rows: fonte ÚNICA do cálculo (refresh e "hoje" da RPC). Usa SQL
-- dinâmico de propósito: com os valores literais o planner pega
-- idx_wa_msg_created_at (~40 ms/dia); parametrizado ele varria as 354 mil
-- mensagens das instâncias Meta por idx_whatsapp_messages_instance_id
-- (~520 ms, 128 mil buffers). Por isso não foi preciso índice novo.
--
-- Classificação (só is_from_me e instância meta_cloud), conferida contra os
-- dados reais de 30 dias até 01/10/2026 — 0 mensagens sem classificação:
--   técnico   = sent_by_user_id preenchido E sem metadata.system_message.
--               A pergunta do CSAT e o "Atendimento encerrado com sucesso"
--               saem do encerramento COM o sent_by_user_id do técnico e a
--               marca system_message (~3.500/mês) — não são digitados por ele.
--   template  = metadata.template_name (técnico ou automação).
--   o resto vira automation_type pela ordem do CASE abaixo. inactivity_close
--   vem ANTES de inactivity_eod: o encerramento de fim de expediente traz as
--   duas chaves e cairia como aviso.
--
-- atendimentos = atendimentos ENCERRADOS no dia com assigned_to = técnico
-- (support_attendances.closed_at + instance_id). Somável entre dias, ao
-- contrário de "distinct atendimento por dia".
-- =============================================================================

create table if not exists public.whatsapp_cost_daily (
  tenant_id        uuid    not null references public.tenants(id) on delete cascade,
  instance_id      uuid    not null,  -- sem FK: o histórico de custo sobrevive à exclusão do canal
  dia              date    not null,  -- dia em America/Sao_Paulo
  actor_kind       text    not null check (actor_kind in ('tecnico','automacao')),
  user_id          uuid,
  automation_type  text,
  enviadas         integer not null default 0,
  cobradas         integer not null default 0,
  com_pricing      integer not null default 0,
  rajadas          integer not null default 0,
  vazias           integer not null default 0,
  curtas           integer not null default 0,
  midias           integer not null default 0,
  conversas        integer not null default 0,
  atendimentos     integer not null default 0,
  updated_at       timestamptz not null default now()
);
create unique index if not exists uq_whatsapp_cost_daily
  on public.whatsapp_cost_daily (tenant_id, instance_id, dia, actor_kind, user_id, automation_type)
  nulls not distinct;
create index if not exists idx_whatsapp_cost_daily_tenant_dia
  on public.whatsapp_cost_daily (tenant_id, dia);

alter table public.whatsapp_cost_daily enable row level security;
drop policy if exists wcd_select on public.whatsapp_cost_daily;
create policy wcd_select on public.whatsapp_cost_daily
  for select to authenticated
  using ((tenant_id = public.current_tenant_id() and public.is_admin_or_head()) or public.is_super_admin());

revoke all on public.whatsapp_cost_daily from public, anon, authenticated;
grant select on public.whatsapp_cost_daily to authenticated;
grant all on public.whatsapp_cost_daily to service_role;

-- -----------------------------------------------------------------------------
-- Fonte única do cálculo
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
begin
  return query execute $q$
with inst as (
  select wi.id, wi.tenant_id from public.whatsapp_instances wi
  where wi.provider_type = 'meta_cloud' and ($1::uuid is null or wi.tenant_id = $1)
),
win as (
  -- 10 min antes do início para o lag da rajada funcionar na virada do dia.
  -- created_at é o filtro que usa índice; "timestamp" é o recorte exato
  -- (diferença medida entre os dois: p99 0,5 s, máx 26 s).
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
),
agg as (
  select c.tenant_id, c.instance_id,
         (c.ts at time zone 'America/Sao_Paulo')::date as dia,
         c.actor_kind, c.user_id, c.automation_type,
         count(*)::int as enviadas,
         count(*) filter (where p.billable)::int as cobradas,
         count(p.message_id)::int as com_pricing,
         count(*) filter (where c.is_tec and c.automation_type is null
                            and c.prev_from_me and c.prev_user = c.sent_by_user_id
                            and c.ts - c.prev_ts <= interval '60 seconds')::int as rajadas,
         count(*) filter (where c.message_type = 'text' and c.content ~* E'^\\s*(ok|okay|certo|entendi|blz|beleza|perfeito|show|isso|sim|não|nao|um momento|só um momento|aguarde|obrigad[oa]|de nada|bom dia|boa tarde|boa noite|olá|ola|oi)[\\s!.,\\U0001F60A\\U0001F642\\U0001F44D]*$')::int as vazias,
         count(*) filter (where c.message_type = 'text' and length(c.content) <= 25)::int as curtas,
         count(*) filter (where c.message_type in ('image','video','audio','document','sticker'))::int as midias,
         count(distinct c.conversation_id)::int as conversas
  from cls2 c
  left join public.whatsapp_message_pricing p on p.tenant_id = c.tenant_id and p.message_id = c.message_id
  group by 1,2,3,4,5,6
),
att as (
  select sa.tenant_id, sa.instance_id,
         (sa.closed_at at time zone 'America/Sao_Paulo')::date as dia,
         sa.assigned_to as user_id, count(*)::int as atendimentos
  from public.support_attendances sa
  join inst on inst.id = sa.instance_id
  where sa.closed_at >= $2 and sa.closed_at < $3 and sa.assigned_to is not null
  group by 1,2,3,4
),
tc as (
  select * from agg where actor_kind = 'tecnico' and automation_type is null
)
select coalesce(a.tenant_id, t.tenant_id), coalesce(a.instance_id, t.instance_id),
       coalesce(a.dia, t.dia), 'tecnico'::text,
       coalesce(a.user_id, t.user_id), null::text,
       coalesce(a.enviadas,0), coalesce(a.cobradas,0), coalesce(a.com_pricing,0),
       coalesce(a.rajadas,0), coalesce(a.vazias,0), coalesce(a.curtas,0),
       coalesce(a.midias,0), coalesce(a.conversas,0), coalesce(t.atendimentos,0)
from tc a
full join att t using (tenant_id, instance_id, dia, user_id)
union all
select tenant_id, instance_id, dia, actor_kind, user_id, automation_type,
       enviadas, cobradas, com_pricing, rajadas, vazias, curtas, midias, conversas, 0
from agg where not (actor_kind = 'tecnico' and automation_type is null)
$q$ using p_tenant, p_from, p_to;
end
$fn$;

revoke all on function public._wa_cost_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Refresh do agregado (delete + insert por dia). Só cron / service role.
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
begin
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'refresh_whatsapp_cost_daily: periodo invalido (% a %)', p_from, p_to;
  end if;
  if p_to - p_from > 400 then
    raise exception 'refresh_whatsapp_cost_daily: periodo maior que 400 dias';
  end if;

  d := p_from;
  while d <= p_to loop
    delete from public.whatsapp_cost_daily where dia = d;
    insert into public.whatsapp_cost_daily (
      tenant_id, instance_id, dia, actor_kind, user_id, automation_type,
      enviadas, cobradas, com_pricing, rajadas, vazias, curtas, midias, conversas, atendimentos
    )
    select r.tenant_id, r.instance_id, r.dia, r.actor_kind, r.user_id, r.automation_type,
           r.enviadas, r.cobradas, r.com_pricing, r.rajadas, r.vazias, r.curtas, r.midias, r.conversas, r.atendimentos
    from public._wa_cost_rows(
      null,
      d::timestamp at time zone 'America/Sao_Paulo',
      (d + 1)::timestamp at time zone 'America/Sao_Paulo'
    ) r;
    get diagnostics k = row_count;
    n := n + k;
    d := d + 1;
  end loop;
  return n;
end
$fn$;

revoke all on function public.refresh_whatsapp_cost_daily(date, date) from public, anon, authenticated;
grant execute on function public.refresh_whatsapp_cost_daily(date, date) to service_role;

-- -----------------------------------------------------------------------------
-- RPC do painel
--
-- Escopo: super admin = qualquer tenant; admin/head = tenant inteiro;
-- user = só as próprias linhas de técnico + mediana do time (sem nomes).
-- Dias até ontem vêm do agregado; hoje (e ontem, até 00:30 SP, antes do
-- cron das 00:10 ter certeza de ter rodado) vêm de _wa_cost_rows ao vivo.
--
-- Custo:
--   fonte 'real'     — >= 90% das enviadas do período têm pricing da Meta:
--                      cobradas reais × preço.
--   fonte 'estimado' — franquia por número e por mês: o excedente de cada
--                      (instância, dia) = max(0, acumulado − franquia) −
--                      max(0, acumulado_anterior − franquia), rateado entre
--                      as linhas do dia pela proporção de enviadas.
-- -----------------------------------------------------------------------------
create or replace function public.get_whatsapp_cost_dashboard(
  p_tenant_id uuid,
  p_from date,
  p_to date,
  p_instance_id uuid default null
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
  v_now_sp    timestamp := now() at time zone 'America/Sao_Paulo';
  v_today     date := (now() at time zone 'America/Sao_Paulo')::date;
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

  v_full := v_sa or v_role in ('admin', 'head');
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
    select * from r where v_full or (actor_kind = 'tecnico' and user_id = v_uid)
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
  -- Estimado: projeta o VOLUME de cada número e só então desconta a franquia —
  -- projetar o excedente direto inflava o começo do mês (no dia 1 a franquia
  -- já acabou e o excedente do dia era multiplicado por 31). No escopo
  -- 'proprio' o técnico leva a fração dele no volume do tenant.
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
  med as (
    select (percentile_cont(0.5) within group (order by env::numeric / att))::numeric as med
    from (
      select user_id, sum(enviadas) as env, sum(atendimentos) as att
      from r
      where no_periodo and actor_kind = 'tecnico' and automation_type is null and user_id is not null
      group by user_id
    ) x
    where att >= 5
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

revoke all on function public.get_whatsapp_cost_dashboard(uuid, date, date, uuid) from public, anon;
grant execute on function public.get_whatsapp_cost_dashboard(uuid, date, date, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Cron: 03:10 UTC = 00:10 SP. Refaz D-2 e D-1 (o pricing da Meta pode chegar
-- depois da virada; a 2ª passada pega o atrasado). Às 00:10 e não 03:40 como
-- no rascunho: até o cron rodar, ontem fica fora do agregado — a RPC cobre a
-- janela calculando ontem ao vivo até 00:30.
-- Backfill inicial (rodado uma vez em 02/10/2026, 2.079 linhas):
--   select public.refresh_whatsapp_cost_daily(current_date - 35, current_date - 1);
-- -----------------------------------------------------------------------------
select cron.schedule(
  'refresh-whatsapp-cost-daily',
  '10 3 * * *',
  $$select public.refresh_whatsapp_cost_daily(((now() at time zone 'America/Sao_Paulo')::date - 2), ((now() at time zone 'America/Sao_Paulo')::date - 1))$$
);
