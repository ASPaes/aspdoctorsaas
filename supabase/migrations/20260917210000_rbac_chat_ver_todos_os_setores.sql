-- ============================================================================
-- RBAC — "Ver conversas de todos os setores" vira permissão
--
-- Hoje isso é um `admin ou gestor` embutido em 5 lugares (4 de tela, 1 de banco).
-- Não existe onde ligar ou desligar: quem é gestor vê todos os setores, e ponto.
-- Esta migration transforma o comportamento em permissão, SEM mudar o acesso
-- de ninguém no dia da publicação.
--
-- SEMEADURA = O ACESSO DE HOJE:
--   Administrador (nivel_base admin) ligado · Gestor (head) ligado · Operador (user) desligado.
--
-- POR QUE DUAS TABELAS, e não só `group_permissions`:
--   · 2 empresas estão no motor v2 (grupos)      -> group_permissions
--   · 10 estão no motor antigo (rbac_enabled)    -> role_permissions  ← sem esta
--     linha a cadeia termina em `false` e o GESTOR delas perderia o seletor de
--     setores no dia da publicação.
--   · 4 estão com rbac_enabled=false             -> o motor devolve `true` para
--     tudo; não precisam de linha e não mudam.
--
-- O QUE NÃO ENTRA AQUI, de propósito:
--   · O padrão de ABERTURA do chat (admin abre em "Todos", gestor abre no próprio
--     setor) é outra regra — decisão do owner em 24/08 — e continua no papel.
--   · "Ver encerradas de outras pessoas", "assumir/agendar em conversa alheia",
--     "filtros avançados" e "trocar responsável" são outras permissões, cada uma
--     com a sua entrega.
-- ============================================================================
begin;

-- ------------------------------------------------------------- o item novo
-- `resources.module` é texto legado e NOT NULL: sai do nome do módulo
-- normalizado, como no catálogo (migration 060000).
insert into public.resources
  (key, module, module_id, label, description, where_it_appears, parent_key, display_order, is_navigation, hidden, nivel)
select 'atend.todos_setores', m.nome, 'atendimento', 'Ver conversas de todos os setores',
   'Sem isto, a pessoa só enxerga as conversas do próprio setor (o do cadastro em Funcionários). Vale na lista, na busca em mensagens e no banco.',
   'Chat > seletor de setores','atendimento_chat',449,false,false,2
  from public.permission_modules m where m.id = 'atendimento'
on conflict (key) do nothing;

-- Mesma casa das irmãs do Chat (`atend.busca`, `atend.historico_terceiros`).
update public.resources
   set grupo = 'Chat', grupo_ordem = 20, secao = 'aba', acoes = '{view}'
 where key = 'atend.todos_setores';

-- ------------------------------------------- motor antigo (10 empresas)
-- Espelha o que vale hoje: admin e head veem todos os setores, user não.
insert into public.role_permissions (role, resource_key, can_view, can_insert, can_update, can_delete)
values ('admin','atend.todos_setores', true,  false, false, false),
       ('head', 'atend.todos_setores', true,  false, false, false),
       ('user', 'atend.todos_setores', false, false, false, false)
on conflict (role, resource_key) do nothing;

-- ------------------------------------------------ motor v2 (grupos)
-- O grupo carrega o nível base; é ele que diz o que a pessoa podia fazer ontem.
insert into public.group_permissions (group_id, resource_key, can_view, can_insert, can_update, can_delete)
select g.id, 'atend.todos_setores', g.nivel_base in ('admin','head'), false, false, false
  from public.permission_groups g
on conflict (group_id, resource_key) do nothing;

-- ============================================================ o portão no banco
-- As 3 policies de leitura do chat tinham o MESMO ramo `is_admin_or_head()`.
-- Ele vira a permissão. Mantidas PERMISSIVE (é a policy original, que concede);
-- as RESTRICTIVE do RBAC continuam por cima, sem mudança.
--
-- ⚠️ DDL de policy em tabelas cujas policies se referenciam vai UMA POR
-- TRANSAÇÃO: em 15/09, as três juntas causaram deadlock em produção e
-- derrubaram 3 requisições do app (`lock_timeout` não evita deadlock).
-- Por isso cada uma tem o seu `commit` aqui.
alter policy whatsapp_conversations_select on public.whatsapp_conversations
  using (
    (select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id())
        and ((select public.has_perm('atend.todos_setores','view'))
             or department_id = (select public.current_user_department_id())
             or department_id is null
             or is_group = true))
  );
commit;

begin;
alter policy support_attendances_select on public.support_attendances
  using (
    (select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id())
        and ((select public.has_perm('atend.todos_setores','view'))
             or department_id = (select public.current_user_department_id())
             or department_id is null
             or is_group = true))
  );
commit;

begin;
-- Mensagens seguem a conversa: sem o mesmo portão aqui, quem perdesse a
-- permissão continuaria lendo as mensagens dos outros setores pela API.
alter policy whatsapp_messages_select on public.whatsapp_messages
  using (
    (select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id())
        and (select public.has_perm('atend.todos_setores','view')))
    or exists (
      select 1 from public.whatsapp_conversations c
       where c.id = whatsapp_messages.conversation_id
         and c.tenant_id = (select public.current_tenant_id())
         and (c.is_group = true
              or c.department_id = (select public.current_user_department_id())
              or c.department_id is null
              or c.assigned_to = (select auth.uid())))
  );
commit;
