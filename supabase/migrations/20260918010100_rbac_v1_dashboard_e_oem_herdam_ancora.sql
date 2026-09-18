-- RBAC v1: abas do Dashboard principal e seção OEM herdam a chave antiga
--
-- APLICADA EM PRODUÇÃO EM 17/09/2026 (SQL Editor, pelo Alexandre). Este arquivo
-- só versiona o que já rodou. Mesmo furo da migration 20260918010000: no v1
-- a `get_my_permissions` não lê `group_permissions`, e estas chaves só tinham
-- linha por grupo.
--
-- Estado antes, nas 9 empresas no v1:
--   * `dash.*` — 49 pessoas abriam o Dashboard e não viam nenhuma aba. Até
--     14/09 (b2874d4d) as abas não tinham controle próprio: herdam `nav.dashboard`.
--   * `cfg.integracoes_oem` — 24 pessoas perderam a seção OEM em
--     Configurações › Integrações. Até 14/09 (73edd17a) a seção era controlada
--     por `cfg.integracoes_omie`: herda dela.
--
-- Fora de propósito: `dash.meu_painel` e `dash.valores_financeiros` (ver R$ nos
-- painéis). Nenhuma tela publicada usa as duas para esconder nada, e a segunda
-- é sensível: quem decide é quem cuida do RBAC.
--
-- Medido depois de aplicar: 24 linhas globais + 240 por empresa; 49 de 49 veem
-- as abas, 24 de 24 veem a seção OEM, e tudo bate com os grupos de sistema.
--
-- Idempotente: `on conflict do nothing`.

begin;

set local lock_timeout = '5s';

insert into public.role_permissions
  (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, k.key, rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  from public.role_permissions rp
  cross join (values ('dash.visao_geral'), ('dash.crescimento'), ('dash.cancelamentos'),
                     ('dash.vendas'), ('dash.distribuicao'), ('dash.cs'), ('dash.cohort')) k(key)
 where rp.resource_key = 'nav.dashboard'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, k.key,
       trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
  cross join (values ('dash.visao_geral'), ('dash.crescimento'), ('dash.cancelamentos'),
                     ('dash.vendas'), ('dash.distribuicao'), ('dash.cs'), ('dash.cohort')) k(key)
 where trp.resource_key = 'nav.dashboard'
on conflict (tenant_id, role, resource_key) do nothing;

insert into public.role_permissions
  (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, 'cfg.integracoes_oem', rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  from public.role_permissions rp
 where rp.resource_key = 'cfg.integracoes_omie'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions
  (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, 'cfg.integracoes_oem',
       trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
 where trp.resource_key = 'cfg.integracoes_omie'
on conflict (tenant_id, role, resource_key) do nothing;

commit;
