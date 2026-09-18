-- ============================================================================
-- RBAC — a chave `tickets` precisa responder igual a `nav.tickets`
--
-- ACHADO NA PUBLICAÇÃO DE 17/09/2026, antes de qualquer estrago:
-- o menu lateral que está NO AR pergunta por `nav.tickets`; o frontend novo
-- pergunta por `tickets`. A taxonomia (migration 140000) funde as duas e apaga
-- `nav.tickets` — mas a sobrevivente `tickets` nasceu no catálogo desta entrega
-- e **não tem linha nenhuma** de papel: 0 no padrão global, 0 por empresa.
--
-- Medido em produção: das 10 chaves do menu novo, 9 têm 3 linhas globais + 30
-- por empresa. `tickets` tem 0 e 0. A cadeia termina em `false`.
--
-- Consequência sem esta migration: assim que o frontend novo subir, o menu
-- Tickets some para TODA empresa que não estiver no motor v2 — hoje, 12 das 14.
-- (Nas do v2 o item já foi semeado a partir da âncora, em 070000.)
--
-- Aqui `tickets` passa a herdar, linha a linha, o que `nav.tickets` concede
-- hoje. Nada muda para ninguém: é a mesma resposta, com outro nome.
-- ============================================================================
begin;

insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, 'tickets', rp.can_view, rp.can_insert, rp.can_update, rp.can_delete
  from public.role_permissions rp
 where rp.resource_key = 'nav.tickets'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select trp.tenant_id, trp.role, 'tickets', trp.can_view, trp.can_insert, trp.can_update, trp.can_delete
  from public.tenant_role_permissions trp
 where trp.resource_key = 'nav.tickets'
on conflict (tenant_id, role, resource_key) do nothing;

commit;
