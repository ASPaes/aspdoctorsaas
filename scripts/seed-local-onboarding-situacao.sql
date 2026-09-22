-- Complemento do `seed-local-onboarding-sla.sql` para o print do DEM-0439: o
-- drill-down das faixas "Situação das jornadas" e "SLA Total".
--
-- O primeiro seed deixa as 14 jornadas em andamento e sem passagem de FASE — com
-- isso a faixa de situação mostra um número só e a de SLA abre zerada, que é
-- justamente o que estes cartões precisam exibir. Aqui entram:
--   1. alvo de SLA no pipeline (sem ele, `vw_onboarding_journey_phases` não tem
--      contra o que comparar e nenhuma jornada conta como "com SLA");
--   2. a passagem pela fase Onboarding de cada jornada, que é a linha que a view lê;
--   3. duas pausas, para o cartão "Tempo parado" sair de zero;
--   4. três jornadas concluídas e duas canceladas (com o evento do ticket, que é de
--      onde sai a data de cancelamento), para os quatro cartões da faixa de situação.
--
-- Idempotente: ids fixos, tudo por upsert. Rodar DEPOIS do seed-local-onboarding-sla.
begin;
set local session_replication_role = replica;  -- nenhum gatilho recalcula o que eu gravo

\set tenant  '''d0000000-0000-0000-0000-00000000dead'''
\set phase   '''14195bdb-9066-4121-9284-0e56d6fe31f7'''
\set pipe    '''d0000000-0000-0000-0000-00000000f101'''

-- Sem expediente configurado, a fn segundos_uteis devolve 0 e TODO tempo útil sai
-- zerado — os cartões de prazo abrem 100% e o painel não mostra nada. O banco
-- local nasce com business_hours vazio, que passa no teste de "existe" e não
-- tem um dia sequer. Seg-sex, 08:00-12:00 e 13:00-18:00.
update configuracoes
   set business_hours_enabled = true,
       business_hours = (
         select jsonb_object_agg(d, jsonb_build_object(
           'active', d in ('mon','tue','wed','thu','fri'),
           'slots', jsonb_build_array(
             jsonb_build_object('start', '08:00', 'end', '12:00'),
             jsonb_build_object('start', '13:00', 'end', '18:00'))))
         from unnest(array['sun','mon','tue','wed','thu','fri','sat']) d)
 where tenant_id = :tenant;

-- 10h de expediente: com as durações do outro seed, 3 das 12 jornadas estouram.
update onboarding_pipelines set sla_total_minutos = 600 where id = :pipe;

-- A passagem pela fase Onboarding. `sla_util_min` e `sla_pausado_min` são
-- calculados PELA VIEW a partir destas duas datas e das pausas abaixo — as
-- colunas de minutos da tabela não são lidas por ela.
insert into onboarding_phase_metrics (id, tenant_id, journey_id, fase, phase_id, pipeline_id, iniciada_em, concluida_em, responsavel_user_id)
select ('d0000000-0000-0000-0000-00000005' || lpad(n::text, 4, '0'))::uuid,
       :tenant,
       j.id,
       'onboarding',
       :phase,
       :pipe,
       j.sla_iniciado_em,
       j.sla_iniciado_em + make_interval(mins => v.cal),
       j.responsavel_user_id
from (values
  ( 1, 1989), ( 2, 2782), ( 3, 2580), ( 4, 1680), ( 5, 1560), ( 6, 1440), ( 7, 1438),
  ( 8, 4320), ( 9, 1352), (10, 4200), (11,  442), (12, 1115), (13,  169), (14,  104)
) as v(n, cal)
join onboarding_journeys j on j.id = ('d0000000-0000-0000-0000-00000003' || lpad(v.n::text, 4, '0'))::uuid
on conflict (journey_id, phase_id) do update
  set iniciada_em = excluded.iniciada_em, concluida_em = excluded.concluida_em;

-- Duas pausas, para "Tempo parado" ter de onde sair. A fase tem que ser a MESMA
-- slug da passagem, senão a view não casa as duas e o tempo parado some.
insert into onboarding_pauses (id, tenant_id, journey_id, fase, motivo_texto, iniciada_em, finalizada_em, duracao_minutos)
select ('d0000000-0000-0000-0000-00000006' || lpad(v.n::text, 4, '0'))::uuid,
       :tenant, j.id, 'onboarding', v.motivo,
       j.sla_iniciado_em + make_interval(hours => 2),
       j.sla_iniciado_em + make_interval(hours => 2, mins => v.mins),
       v.mins
from (values
  ( 2, 180, 'Aguardando documentos do cliente'),
  ( 8, 420, 'Cliente em reforma da loja')
) as v(n, mins, motivo)
join onboarding_journeys j on j.id = ('d0000000-0000-0000-0000-00000003' || lpad(v.n::text, 4, '0'))::uuid
on conflict (id) do update set finalizada_em = excluded.finalizada_em, duracao_minutos = excluded.duracao_minutos;

-- Três concluídas e duas canceladas, dentro do mês corrente (o período padrão do
-- dashboard). O resto continua em andamento.
update onboarding_journeys j
   set situacao = 'concluido',
       concluido_em = j.sla_iniciado_em + make_interval(days => 6),
       onboarding_concluido_em = j.sla_iniciado_em + make_interval(days => 4)
 where j.id in (
   'd0000000-0000-0000-0000-000000030003', 'd0000000-0000-0000-0000-000000030006',
   'd0000000-0000-0000-0000-000000030011');

update onboarding_journeys set situacao = 'cancelado'
 where id in ('d0000000-0000-0000-0000-000000030013', 'd0000000-0000-0000-0000-000000030014');

-- A data de cancelamento NÃO mora na jornada: o dashboard a lê do evento do ticket.
insert into support_ticket_events (id, tenant_id, ticket_id, event_type, content, created_at)
select ('d0000000-0000-0000-0000-00000007' || lpad(v.n::text, 4, '0'))::uuid,
       :tenant, j.ticket_id, 'onboarding_cancelado', 'Cliente desistiu da implantação',
       j.sla_iniciado_em + make_interval(days => 3)
from (values (13), (14)) as v(n)
join onboarding_journeys j on j.id = ('d0000000-0000-0000-0000-00000003' || lpad(v.n::text, 4, '0'))::uuid
on conflict (id) do update set created_at = excluded.created_at;

commit;

select situacao, count(*) from onboarding_journeys group by 1 order by 1;
select count(*) as fases_medidas, count(*) filter (where sla_util_min + sla_pausado_min > 600) as fora_do_prazo,
       sum(sla_pausado_min) as parado_min
  from vw_onboarding_journey_phases;
