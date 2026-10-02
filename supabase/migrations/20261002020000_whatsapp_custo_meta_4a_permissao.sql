-- =============================================================================
-- Custo do WhatsApp Oficial (Meta) — fase 4a: permissão "Ver custo do WhatsApp Oficial"
--
-- Decisão do Alexandre (02/10/2026): quem vê o custo da EMPRESA é decidido nas
-- permissões, não pelo papel. A mesma chave libera:
--   · a aba "Custo WhatsApp Oficial" do Painel de Uso;
--   · a sub-aba "WhatsApp Oficial" da Visão 360° do cliente.
-- Sem ela, a pessoa vê só o próprio custo, na Visão 360° do colaborador (que
-- segue a regra de quem-vê-quem da própria 360°, sem chave).
--
-- Nasce com o acesso de HOJE: o Painel de Uso é só do admin. Herda de
-- nav.painel_uso nos 4 degraus (global, empresa, grupo, pessoa) — conferido em
-- 02/10: admin=true e head/user=false em todas as 14 empresas e nos 34 grupos;
-- nenhuma permissão individual.
--
-- parent_key nulo de propósito: a cascata pai→filho esconderia a sub-aba da
-- 360° do cliente de quem não abre o Painel de Uso (mesmo caso de email.*).
-- `resources` é catálogo quente: transação própria, sem DDL junto.
-- =============================================================================

begin;

insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key,
   display_order, is_navigation, hidden, nivel, acoes, secao, grupo, grupo_ordem)
values
  ('painel_uso.custo_whatsapp', 'Painel de Uso', 'painel_uso', 'Ver custo do WhatsApp Oficial',
   'Custo da empresa na API Oficial da Meta: por número, por automação e por técnico, com nomes. Sem isto, a pessoa vê só o próprio custo, na Visão 360° dela. Também libera a sub-aba de custo na Visão 360° do cliente.',
   'Painel de Uso › Custo WhatsApp Oficial · Clientes › Visão 360° › WhatsApp Oficial',
   null, 2, false, false, 2, '{view}', 'aba', 'Custo WhatsApp Oficial', 10)
on conflict (key) do nothing;

insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, 'painel_uso.custo_whatsapp', rp.can_view, false, false, false
  from public.role_permissions rp
 where rp.resource_key = 'nav.painel_uso'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select t.tenant_id, t.role, 'painel_uso.custo_whatsapp', t.can_view, false, false, false
  from public.tenant_role_permissions t
 where t.resource_key = 'nav.painel_uso'
on conflict (tenant_id, role, resource_key) do nothing;

insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.group_id, 'painel_uso.custo_whatsapp', g.can_view, false, false, false
  from public.group_permissions g
 where g.resource_key = 'nav.painel_uso'
on conflict (group_id, resource_key) do nothing;

insert into public.user_permissions (tenant_id, user_id, resource_key, can_view, can_insert, can_update, can_delete)
select u.tenant_id, u.user_id, 'painel_uso.custo_whatsapp', u.can_view, false, false, false
  from public.user_permissions u
 where u.resource_key = 'nav.painel_uso'
on conflict (user_id, resource_key) do nothing;

commit;
