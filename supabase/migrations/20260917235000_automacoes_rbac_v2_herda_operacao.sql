-- DEM-0410 | A aba Automações no RBAC v2
--
-- ACHADO NA HORA DO PUSH, 17/09/2026. O bloco 1 desta entrega cadastrou
-- `cfg.automacoes` em `resources` e copiou as 3 linhas globais de
-- `role_permissions` da aba vizinha (Operação). Isso bastava no RBAC de antes.
--
-- Enquanto isso, o RBAC v2 entrou na main com mais dois degraus na cadeia. O
-- `get_my_permissions` resolve assim:
--
--   coalesce(user_permissions, group_permissions, tenant_role_permissions,
--            role_permissions, false)
--
-- Medido em produção agora: `cfg.operacao` tem 30 linhas por empresa (10
-- empresas) e 30 por grupo; `cfg.automacoes` tem ZERO das duas.
--
-- A aba NÃO some por causa disso, porque a cadeia cai no global que o bloco 1
-- gravou. O problema é outro e mais silencioso: a empresa que mexeu na
-- permissão da aba Operação (tirou de head, por exemplo) NÃO vê essa decisão
-- valer para Automações, que continua no padrão de fábrica. Ou seja, uma aba
-- nova nasce fora do que cada empresa configurou.
--
-- Aqui `cfg.automacoes` herda, linha a linha, o que `cfg.operacao` concede
-- hoje nos dois degraus. É o mesmo remédio da migration `tickets herda
-- nav.tickets`, de 17/09.
--
-- Idempotente: `on conflict do nothing`. Rodar de novo não mexe em quem já foi
-- ajustado à mão depois.

begin;

set local lock_timeout = '5s';

-- Por empresa (10 empresas com RBAC ligado)
insert into public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, 'cfg.automacoes',
       trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
 where trp.resource_key = 'cfg.operacao'
on conflict (tenant_id, role, resource_key) do nothing;

-- Por grupo (degrau que vence nas empresas já no motor v2)
insert into public.group_permissions
  (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select gp.group_id, 'cfg.automacoes',
       gp.can_view, gp.can_insert, gp.can_update, gp.can_delete
  from public.group_permissions gp
 where gp.resource_key = 'cfg.operacao'
on conflict (group_id, resource_key) do nothing;

commit;

-- ─── Conferência (rodar depois, leitura pura) ───────────────────────────────
--
-- As duas linhas têm de bater: a aba nova responde igual à vizinha.
--
-- select resource_key,
--        count(*) filter (where origem = 'empresa') as por_empresa,   -- 30 e 30
--        count(*) filter (where origem = 'grupo')   as por_grupo,     -- 30 e 30
--        count(*) filter (where origem = 'global')  as global         -- 3 e 3
--   from (
--     select resource_key, 'empresa'::text as origem from public.tenant_role_permissions
--      where resource_key in ('cfg.operacao','cfg.automacoes')
--     union all
--     select resource_key, 'grupo'::text from public.group_permissions
--      where resource_key in ('cfg.operacao','cfg.automacoes')
--     union all
--     select resource_key, 'global'::text from public.role_permissions
--      where resource_key in ('cfg.operacao','cfg.automacoes')
--   ) x
--  group by resource_key order by resource_key;
