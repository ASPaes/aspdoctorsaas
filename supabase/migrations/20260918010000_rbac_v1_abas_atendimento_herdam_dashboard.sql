-- RBAC v1: abas do Dashboard de Atendimento herdam a permissão do Dashboard
--
-- APLICADA EM PRODUÇÃO EM 17/09/2026 (SQL Editor, pelo Alexandre). Este arquivo
-- só versiona o que já rodou.
--
-- O furo: `get_my_permissions` tem dois ramos. No v2 a cadeia é
--   coalesce(usuario, grupo, empresa, global, false)
-- e no v1 (tenants.rbac_v2_enabled = false) é
--   coalesce(usuario, empresa, global, false)   -- NÃO lê group_permissions.
--
-- O catálogo do RBAC v2 criou as chaves `atd.*` só por grupo (0 global,
-- 0 por empresa). Quando a tela passou a esconder cada aba com
-- `can("atd.<aba>")`, a régua inteira sumiu para os gestores das 9 empresas
-- no v1 (Athuz, Consysa, CTM, Delvale, Digi Office, Feax, Liberty, Look,
-- PS Tecnologia): 0 de 53 viam qualquer aba. Super admin e a ASP (v2) viam.
--
-- Remédio: cada `atd.*` herda, nos degraus que o v1 lê, a linha de
-- `nav.atendimento_dashboard`. Até 14/09 as abas não tinham controle próprio,
-- então é a mesma resposta de antes. Mesmo padrão de "tickets herda nav.tickets".
--
-- Medido depois de aplicar: 36 linhas globais + 360 por empresa; 53 de 53
-- gestores que abrem o Dashboard veem todas as abas; e as combinações
-- empresa × papel × chave batem 100% com o que os grupos de sistema
-- (administrador/gestor/operador) já concediam no v2. Ninguém ganhou acesso.
--
-- Idempotente: `on conflict do nothing`.

begin;

set local lock_timeout = '5s';

insert into public.role_permissions
  (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, r.key, rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  from public.role_permissions rp
  cross join public.resources r
 where rp.resource_key = 'nav.atendimento_dashboard'
   and r.key like 'atd.%'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, r.key,
       trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
  cross join public.resources r
 where trp.resource_key = 'nav.atendimento_dashboard'
   and r.key like 'atd.%'
on conflict (tenant_id, role, resource_key) do nothing;

commit;
