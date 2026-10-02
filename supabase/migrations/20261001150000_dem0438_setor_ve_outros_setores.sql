-- ============================================================================
-- DEM-0438 — um setor pode enxergar o chat de outros setores
--
-- Dor: no pico, ou sem agente no N1, o cliente fica parado na fila do N1 e o N2
-- não vê, então não consegue puxar. Agora cada setor tem a lista dos OUTROS
-- setores que ele enxerga (`visible_department_ids`). Quem é do setor N2 passa a
-- ver o N1 inteiro como se fosse membro: fila, em andamento e encerrados
-- (decisão de 01/10/2026: setor inteiro, não só a fila).
--
-- Padrão = lista vazia = vê só o próprio setor. Nada muda para ninguém até
-- alguém configurar.
--
-- O portão de verdade é o RLS: `claim_conversation` não checa setor, então
-- quem enxerga a conversa consegue assumir. As 3 policies de SELECT que
-- comparavam `department_id = current_user_department_id()` (um setor só)
-- passam a comparar com a lista `user_visible_department_ids()`. O resto das
-- policies fica idêntico, caractere por caractere.
--
-- Uma transação por tabela, com lock_timeout: as três são quentes e os
-- gatilhos de uma escrevem nas outras — numa transação só, o ALTER POLICY
-- seguraria uma e esperaria a outra (ver migration-deadlock-catalogo-quente).
-- Rodar os blocos SEPARADOS no SQL Editor, na ordem.
-- ============================================================================

-- ------------------------------------------------ 1. coluna + função
begin;
set local lock_timeout = '5s';

alter table public.support_departments
  add column if not exists visible_department_ids uuid[] not null default '{}'::uuid[];

comment on column public.support_departments.visible_department_ids is
  'DEM-0438: outros setores que os membros deste setor enxergam no chat (além do próprio). Vazio = só o próprio.';

-- Setor do cadastro (funcionarios.department_id) + os que ele enxerga.
-- LEFT JOIN: se o setor do cadastro sumir, continua devolvendo o id dele, como
-- current_user_department_id() fazia. Sem setor no cadastro: NULL, e
-- `x = ANY(NULL)` é falso — igual ao `x = NULL` de antes.
create or replace function public.user_visible_department_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select array_remove(
           array[f.department_id] || coalesce(d.visible_department_ids, '{}'::uuid[]),
           null)
  from public.profiles p
  join public.funcionarios f on f.id = p.funcionario_id
  left join public.support_departments d on d.id = f.department_id
  where p.user_id = (select auth.uid())
    and f.department_id is not null
  limit 1;
$$;

revoke all on function public.user_visible_department_ids() from public, anon;
grant execute on function public.user_visible_department_ids() to authenticated, service_role;

commit;

-- ------------------------------------------------ 2. conversas
begin;
set local lock_timeout = '5s';

alter policy whatsapp_conversations_select on public.whatsapp_conversations
  using (
    (select public.is_super_admin())
    or (
      tenant_id = (select public.current_tenant_id())
      and (
        (select public.pode_ver_todos_setores())
        or department_id = any ((select public.user_visible_department_ids())::uuid[])
        or department_id is null
        or is_group = true
      )
    )
  );

commit;

-- ------------------------------------------------ 3. atendimentos
begin;
set local lock_timeout = '5s';

alter policy support_attendances_select on public.support_attendances
  using (
    (select public.is_super_admin())
    or (
      tenant_id = (select public.current_tenant_id())
      and (
        (select public.pode_ver_todos_setores())
        or department_id = any ((select public.user_visible_department_ids())::uuid[])
        or department_id is null
        or is_group = true
      )
    )
  );

commit;

-- ------------------------------------------------ 4. mensagens
begin;
set local lock_timeout = '5s';

alter policy whatsapp_messages_select on public.whatsapp_messages
  using (
    (select public.is_super_admin())
    or (
      tenant_id = (select public.current_tenant_id())
      and (select public.pode_ver_todos_setores())
    )
    or exists (
      select 1
      from public.whatsapp_conversations c
      where c.id = whatsapp_messages.conversation_id
        and c.tenant_id = (select public.current_tenant_id())
        and (
          c.is_group = true
          or c.department_id = any ((select public.user_visible_department_ids())::uuid[])
          or c.department_id is null
          or c.assigned_to = (select auth.uid())
        )
    )
  );

commit;
