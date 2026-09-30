-- =============================================================================
-- Equipe DS (chat interno) — item de menu no catálogo de permissões.
--
-- Arquivo separado da migration das tabelas (20260929153000): `resources` é
-- catálogo quente e misturar com DDL na mesma transação já deu deadlock aqui.
--
-- SEMEADURA: ligado para TODOS os papéis e grupos. O chat da equipe é de todo
-- colaborador; quem vê cada conversa é decidido no banco (RLS + RPCs equipe_*),
-- não pelo menu. A permissão existe para o admin poder desligar se quiser.
--
-- Colunas conferidas no schema de PRODUÇÃO (dump de 29/09/2026): module_id é
-- NOT NULL e FK para permission_modules.
-- =============================================================================
begin;

insert into public.permission_modules (id, nome, descricao, ordem)
values ('equipe', 'Equipe', 'Chat interno entre colaboradores: canais, conversas diretas e grupos.', 65)
on conflict (id) do nothing;

insert into public.resources (
  key, module, module_id, label, description,
  display_order, hidden, is_navigation, where_it_appears,
  nivel, acoes, secao
)
values (
  'nav.equipe', 'Menu Principal', 'equipe', 'Equipe',
  'Chat interno da equipe: canais, conversas diretas e grupos.',
  1, false, true, 'Menu lateral › Equipe',
  1, '{view}', 'entrada'
)
on conflict (key) do nothing;

-- motor antigo (rbac_enabled): todos os papéis
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
values ('admin','nav.equipe', true, false, false, false),
       ('head', 'nav.equipe', true, false, false, false),
       ('user', 'nav.equipe', true, false, false, false)
on conflict (role, resource_key) do nothing;

-- motor v2 (grupos): todos os grupos
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, 'nav.equipe', true, false, false, false
  from public.permission_groups g
on conflict (group_id, resource_key) do nothing;

commit;
