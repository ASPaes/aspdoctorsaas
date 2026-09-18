-- Aba "Jornada / Pausas" no RBAC v2
--
-- ACHADO NA HORA DO PUSH, 17/09/2026. A aba foi feita antes de o RBAC v2
-- entrar na main; lá, toda aba do Dashboard de Atendimento passou a ser
-- liberada por `can("atd.<aba>", "view")`, e `can()` devolve FALSO para
-- recurso que não existe (só super admin passa). Sem este cadastro a aba
-- sumiria para todo gestor.
--
-- Herda de `atd.agentes` porque é a mesma sensibilidade: produtividade
-- individual de cada operador. Quem pode ver a produtividade de um agente pode
-- ver as pausas dele; quem não pode, não vê nenhuma das duas.
--
-- A cadeia do get_my_permissions é
--   coalesce(user_permissions, group_permissions, tenant_role_permissions,
--            role_permissions, false)
-- e a herança copia os QUATRO degraus, não só o que tem linha hoje. Medido em
-- produção agora: atd.agentes tem 42 linhas por grupo e ZERO global, por
-- empresa e por usuário. Os três inserts vazios ficam de propósito: se alguém
-- configurar a Agentes nesses degraus antes deste arquivo rodar, a Jornada
-- acompanha.
--
-- Mesmo remédio de "tickets herda nav.tickets" e "automações herda operação",
-- ambas de 17/09.
--
-- Idempotente: `on conflict do nothing`. Rodar de novo não mexe em quem já foi
-- ajustado à mão depois.

begin;

set local lock_timeout = '5s';

-- Catálogo: mesma linha da Agentes, com rótulo, descrição e ordem próprios.
-- display_order 351 = logo depois de Cobertura (350), que é onde a aba aparece.
insert into public.resources
  (key, module, label, description, parent_key, display_order, hidden,
   is_navigation, where_it_appears, module_id, nivel, acoes, secao, grupo, grupo_ordem)
select 'atd.jornada', r.module, 'Aba Jornada / Pausas',
       'Histórico de pausas e jornada de cada operador.',
       r.parent_key, 351, r.hidden, r.is_navigation,
       'Dashboard de Atendimento › Jornada / Pausas',
       r.module_id, r.nivel, r.acoes, r.secao, r.grupo, r.grupo_ordem
  from public.resources r
 where r.key = 'atd.agentes'
on conflict (key) do nothing;

-- Global
insert into public.role_permissions
  (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, 'atd.jornada', rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  from public.role_permissions rp
 where rp.resource_key = 'atd.agentes'
on conflict do nothing;

-- Por empresa
insert into public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, 'atd.jornada',
       trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
 where trp.resource_key = 'atd.agentes'
on conflict do nothing;

-- Por grupo (o degrau que tem linha hoje)
insert into public.group_permissions
  (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select gp.group_id, 'atd.jornada',
       gp.can_view, gp.can_insert, gp.can_update, gp.can_delete
  from public.group_permissions gp
 where gp.resource_key = 'atd.agentes'
on conflict do nothing;

-- Por usuário
insert into public.user_permissions
  (user_id, tenant_id, resource_key, can_view, can_insert, can_update, can_delete)
select up.user_id, up.tenant_id, 'atd.jornada',
       up.can_view, up.can_insert, up.can_update, up.can_delete
  from public.user_permissions up
 where up.resource_key = 'atd.agentes'
on conflict do nothing;

commit;

-- ─── Conferência (rodar depois, leitura pura) ───────────────────────────────
-- As duas linhas têm de bater: a Jornada responde igual à Agentes.
--
-- select resource_key,
--        count(*) filter (where origem = 'global')  as global,
--        count(*) filter (where origem = 'empresa') as por_empresa,
--        count(*) filter (where origem = 'grupo')   as por_grupo,
--        count(*) filter (where origem = 'usuario') as por_usuario
--   from (
--     select resource_key, 'global'::text  as origem from public.role_permissions
--      where resource_key in ('atd.agentes','atd.jornada')
--     union all
--     select resource_key, 'empresa'::text from public.tenant_role_permissions
--      where resource_key in ('atd.agentes','atd.jornada')
--     union all
--     select resource_key, 'grupo'::text   from public.group_permissions
--      where resource_key in ('atd.agentes','atd.jornada')
--     union all
--     select resource_key, 'usuario'::text from public.user_permissions
--      where resource_key in ('atd.agentes','atd.jornada')
--   ) x
--  group by resource_key order by resource_key;
