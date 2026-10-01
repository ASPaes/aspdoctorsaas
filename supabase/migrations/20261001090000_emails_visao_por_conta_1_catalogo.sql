-- =============================================================================
-- E-mails — quem vê o quê passa a depender da CONTA (1/3: catálogo)
--
-- Regra decidida pelo Alexandre em 30/09/2026 (caso Delvale):
--   · admin e super admin veem tudo, sempre;
--   · conta com USUÁRIO ligado: só esse usuário e o head do setor ligado;
--   · conta só com SETOR ligado: o setor inteiro;
--   · conta sem vínculo: decidem as 4 permissões abaixo.
-- Na conta vinculada a permissão não é consultada.
--
-- "Ver e-mails de todas as pessoas" (email.ver_todos) se divide em quatro:
--   email.ver_saidas          o que EU enviei              semeia: todos
--   email.ver_todos_enviados  o que qualquer pessoa enviou  herda de ver_todos
--   email.ver_entradas        respostas ao que EU enviei    semeia: todos
--   email.ver_todas_entradas  tudo o que chegou             herda de ver_todos
-- As duas "próprias" nascem ligadas para ninguém perder o que já via.
-- email.ver_todos fica no catálogo até a tela parar de usá-la (passo 2).
--
-- A herança copia os 4 degraus (pessoa, grupo, empresa, global): empresa no
-- RBAC v1 não lê grupo, e chave só por grupo some para ela (ver 17/09/2026).
-- `resources` é catálogo quente: transação própria, sem DDL junto.
-- =============================================================================

begin;

insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key,
   display_order, is_navigation, hidden, nivel, acoes, secao, grupo, grupo_ordem)
values
  ('email.ver_saidas', 'E-mails', 'emails', 'Ver os e-mails que enviei',
   'Enviados das contas sem vínculo: os que a própria pessoa mandou. Conta ligada a usuário ou setor não depende desta permissão.',
   'E-mails › Enviados', null, 2, false, false, 2, '{view}', 'aba', 'Caixa de e-mails', 10),
  ('email.ver_todos_enviados', 'E-mails', 'emails', 'Ver todos os enviados',
   'Enviados das contas sem vínculo, de qualquer pessoa. Conta ligada a usuário ou setor não depende desta permissão.',
   'E-mails › Enviados', null, 3, false, false, 2, '{view}', 'aba', 'Caixa de e-mails', 10),
  ('email.ver_entradas', 'E-mails', 'emails', 'Ver as respostas aos meus e-mails',
   'Recebidos das contas sem vínculo: as respostas aos e-mails que a própria pessoa mandou. Conta ligada a usuário ou setor não depende desta permissão.',
   'E-mails › Recebidos', null, 4, false, false, 2, '{view}', 'aba', 'Caixa de e-mails', 10),
  ('email.ver_todas_entradas', 'E-mails', 'emails', 'Ver todos os recebidos',
   'Recebidos das contas sem vínculo: tudo o que chegou. Conta ligada a usuário ou setor não depende desta permissão.',
   'E-mails › Recebidos', null, 5, false, false, 2, '{view}', 'aba', 'Caixa de e-mails', 10)
on conflict (key) do nothing;

-- as ações da caixa descem para depois das quatro
update public.resources set display_order = 6  where key = 'email.ver_todos';
update public.resources set display_order = 7  where key = 'email.lixeira';
update public.resources set display_order = 8  where key = 'email.triagem';
update public.resources set display_order = 9  where key = 'email.ler_agora';
update public.resources set display_order = 10 where key = 'email.macros';
update public.resources set display_order = 11 where key = 'email.agendados_outros';

-- ---- "todos": herdam de email.ver_todos, nos 4 degraus
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select rp.role, k.chave, rp.can_view, false, false, false
  from public.role_permissions rp
 cross join (values ('email.ver_todos_enviados'), ('email.ver_todas_entradas')) k(chave)
 where rp.resource_key = 'email.ver_todos'
on conflict (role, resource_key) do nothing;

insert into public.tenant_role_permissions (tenant_id, role, resource_key, can_view, can_insert, can_update, can_delete)
select t.tenant_id, t.role, k.chave, t.can_view, false, false, false
  from public.tenant_role_permissions t
 cross join (values ('email.ver_todos_enviados'), ('email.ver_todas_entradas')) k(chave)
 where t.resource_key = 'email.ver_todos'
on conflict (tenant_id, role, resource_key) do nothing;

insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.group_id, k.chave, g.can_view, false, false, false
  from public.group_permissions g
 cross join (values ('email.ver_todos_enviados'), ('email.ver_todas_entradas')) k(chave)
 where g.resource_key = 'email.ver_todos'
on conflict (group_id, resource_key) do nothing;

insert into public.user_permissions (tenant_id, user_id, resource_key, can_view, can_insert, can_update, can_delete)
select u.tenant_id, u.user_id, k.chave, u.can_view, false, false, false
  from public.user_permissions u
 cross join (values ('email.ver_todos_enviados'), ('email.ver_todas_entradas')) k(chave)
 where u.resource_key = 'email.ver_todos'
on conflict (user_id, resource_key) do nothing;

-- ---- "próprias": ligadas para todos (é o que todo mundo já via)
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
select r.role, k.chave, true, false, false, false
  from (values ('admin'), ('head'), ('user')) r(role)
 cross join (values ('email.ver_saidas'), ('email.ver_entradas')) k(chave)
on conflict (role, resource_key) do nothing;

insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, k.chave, true, false, false, false
  from public.permission_groups g
 cross join (values ('email.ver_saidas'), ('email.ver_entradas')) k(chave)
on conflict (group_id, resource_key) do nothing;

commit;
