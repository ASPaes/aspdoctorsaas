-- Dado de demonstração do SLA de Onboarding no banco LOCAL, para o print do DEM-0440.
-- Idempotente: ids fixos, tudo por upsert.
begin;
set local session_replication_role = replica;  -- nenhum gatilho recalcula o que eu gravo

\set tenant  '''d0000000-0000-0000-0000-00000000dead'''
\set dept    '''d0000000-0000-0000-0000-0000000000c1'''
\set phase   '''14195bdb-9066-4121-9284-0e56d6fe31f7'''
\set pipe    '''d0000000-0000-0000-0000-00000000f101'''

update tenants set onboarding_enabled = true where id = :tenant;

insert into onboarding_pipelines (id, tenant_id, nome, fase, phase_id, department_id, position, ativo)
values (:pipe, :tenant, 'Onboarding PDV', 'onboarding', :phase, :dept, 0, true)
on conflict (id) do update set nome = excluded.nome, department_id = excluded.department_id;

-- As etapas. "Conferência" é a do print: alvo de 2h.
insert into onboarding_stages (id, tenant_id, pipeline_id, nome, slug, position, sla_minutos)
values
  ('d0000000-0000-0000-0000-00000000f201', :tenant, :pipe, 'Novo Cliente',       'novo-cliente',       0, 120),
  ('d0000000-0000-0000-0000-00000000f202', :tenant, :pipe, 'Conferência',        'conferencia',        1, 120),
  ('d0000000-0000-0000-0000-00000000f203', :tenant, :pipe, 'Recolhimento Dados', 'recolhimento-dados', 2, 480),
  ('d0000000-0000-0000-0000-00000000f204', :tenant, :pipe, 'Cadastro Produtos',  'cadastro-produtos',  3, 960),
  ('d0000000-0000-0000-0000-00000000f205', :tenant, :pipe, 'Treinamento',        'treinamento',        4, 120)
on conflict (id) do update set nome = excluded.nome, sla_minutos = excluded.sla_minutos, position = excluded.position;

-- Uma linha por cliente: nome, minutos de expediente, minutos de calendário e o responsável.
create temp table _fx (n int, nome text, util int, cal int, resp uuid) on commit drop;
insert into _fx values
  ( 1, 'BLU BAKEHOUSE',                1117, 1989, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 2, 'CHURRASCARIA GALPAO GRILL',    1075, 2782, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 3, 'ALOHA PUB',                     864, 2580, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 4, 'BEIRUTE - BAR E CAFE',          853, 1680, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 5, 'BRAZZA SPETTUS',                725, 1560, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 6, 'O MERCADINHO',                  586, 1440, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 7, 'PASSAPORTE',                    568, 1438, 'd0000000-0000-0000-0000-0000000000e1'),
  ( 8, 'PALADAR MINEIRO',               541, 4320, 'd0000000-0000-0000-0000-0000000000e2'),
  ( 9, 'ARAIS COZINHA ARABE',           482, 1352, 'd0000000-0000-0000-0000-0000000000e1'),
  (10, 'DEGUST CLUB',                   470, 4200, 'd0000000-0000-0000-0000-0000000000e2'),
  (11, 'ZAN CAFE',                      442,  442, 'd0000000-0000-0000-0000-0000000000e1'),
  (12, 'BOTECO CHURRASCARIA DO PAULO',  244, 1115, 'd0000000-0000-0000-0000-0000000000e3'),
  (13, 'DISTRIBUIDORA RAMOS',           169,  169, 'd0000000-0000-0000-0000-0000000000e1'),
  (14, 'O ARABE',                       103,  104, 'd0000000-0000-0000-0000-0000000000e4');

-- ids derivados do número da linha: reexecutar não duplica.
insert into clientes (id, tenant_id, razao_social, nome_fantasia, unidade_base_id)
select ('d0000000-0000-0000-0000-00000001' || lpad(n::text, 4, '0'))::uuid, :tenant, nome || ' LTDA', nome, 900001 from _fx
on conflict (id) do update set nome_fantasia = excluded.nome_fantasia;

insert into support_tickets (id, tenant_id, cliente_id, assunto, department_id)
select ('d0000000-0000-0000-0000-00000002' || lpad(n::text, 4, '0'))::uuid, :tenant,
       ('d0000000-0000-0000-0000-00000001' || lpad(n::text, 4, '0'))::uuid,
       'Onboarding ' || nome, :dept
from _fx
on conflict (id) do update set assunto = excluded.assunto;

insert into onboarding_journeys
  (id, tenant_id, ticket_id, cliente_id, pipeline_onboarding_id, current_stage_id,
   fase_atual, situacao, sla_iniciado_em, responsavel_user_id, created_at)
select ('d0000000-0000-0000-0000-00000003' || lpad(n::text, 4, '0'))::uuid, :tenant,
       ('d0000000-0000-0000-0000-00000002' || lpad(n::text, 4, '0'))::uuid,
       ('d0000000-0000-0000-0000-00000001' || lpad(n::text, 4, '0'))::uuid,
       :pipe, 'd0000000-0000-0000-0000-00000000f203',
       'onboarding', 'em_andamento',
       date_trunc('month', now()) + make_interval(days => n, hours => 9),
       resp,
       date_trunc('month', now()) + make_interval(days => n, hours => 9)
from _fx
on conflict (id) do update set responsavel_user_id = excluded.responsavel_user_id;

-- A passagem por Conferência: é ela que alimenta o card e a lista do print.
insert into onboarding_stage_history
  (id, tenant_id, journey_id, stage_id, entrou_em, saiu_em, duracao_minutos, duracao_util_minutos)
select ('d0000000-0000-0000-0000-00000004' || lpad(n::text, 4, '0'))::uuid, :tenant,
       ('d0000000-0000-0000-0000-00000003' || lpad(n::text, 4, '0'))::uuid,
       'd0000000-0000-0000-0000-00000000f202',
       date_trunc('month', now()) + make_interval(days => n, hours => 10),
       date_trunc('month', now()) + make_interval(days => n, hours => 10, mins => cal),
       cal, util
from _fx
on conflict (id) do update set duracao_minutos = excluded.duracao_minutos,
                               duracao_util_minutos = excluded.duracao_util_minutos;
commit;

select count(*) as jornadas from onboarding_journeys;
select count(*) as passagens_conferencia from onboarding_stage_history where stage_id='d0000000-0000-0000-0000-00000000f202';
