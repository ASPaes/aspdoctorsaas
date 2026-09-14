-- ============================================================================
-- F5 — escopo de linha: "quais linhas", e não só "pode ou não pode"
--
-- Generaliza o padrao que ja roda em producao em 5 tabelas (unidade_scope_*),
-- acrescentando os criterios `setor` e `proprio`.
--
-- ESCOPO SO VALE NO MOTOR v2: perm_scope() devolve 'todos' quando
-- rbac_v2_enabled e false, entao os 12 tenants no motor antigo nao mudam.
--
-- `whatsapp_messages` fica DE FORA: so tem conversation_id e 387 mil linhas.
-- Proteger a conversa fecha o acesso na pratica — a mensagem so e alcancada
-- atraves dela, e um join por linha ali derrubaria o banco.
-- ============================================================================
begin;

-- --------------------------------------------- CONVERSAS: setor / próprio
drop policy if exists rbac_conversas_escopo on public.whatsapp_conversations;
create policy rbac_conversas_escopo on public.whatsapp_conversations
  as restrictive for select to authenticated
  using (
    case (select public.perm_scope('atendimento_chat','view'))
      when 'todos'   then true
      -- `&&` (sobreposicao de arrays) em vez de `= any (subconsulta)`: aquela
      -- forma faz o Postgres tratar o uuid[] como escalar e nao compila.
      when 'setor'   then (select public.my_departments()) && array[department_id]
      when 'proprio' then assigned_to = (select auth.uid())
      when 'nenhum'  then false
      else true            -- 'unidade' ja e coberto pelas policies existentes
    end
  );

-- ------------------------------------------- TICKETS: setor / unidade
-- `support_tickets` NAO tem assigned_to (verificado). O dono do ticket vive em
-- support_attendances. Por isso `proprio` aqui passa por EXISTS — mais caro, e
-- por isso fica restrito a quem escolher esse escopo explicitamente.
drop policy if exists rbac_tickets_escopo on public.support_tickets;
create policy rbac_tickets_escopo on public.support_tickets
  as restrictive for select to authenticated
  using (
    case (select public.perm_scope('tickets','view'))
      when 'todos'   then true
      -- `&&` (sobreposicao de arrays) em vez de `= any (subconsulta)`: aquela
      -- forma faz o Postgres tratar o uuid[] como escalar e nao compila.
      when 'setor'   then (select public.my_departments()) && array[department_id]
      when 'proprio' then exists (
        select 1 from public.support_attendances sa
        where sa.ticket_id = support_tickets.id and sa.assigned_to = (select auth.uid()))
      when 'nenhum'  then false
      else true
    end
  );

commit;
