-- ============================================================================
-- SEGURANÇA — admin/gestor lia conversas, mensagens e atendimentos de OUTRAS empresas
--
-- APLICADA EM PRODUÇÃO em 15/09/2026 09:42 (America/Sao_Paulo) via apply_migration,
-- com OK do Alexandre. Este arquivo é o registro; a versão bate com
-- supabase_migrations.schema_migrations (20260915124233).
--
-- Causa: `is_admin_or_head()` só confere papel, não empresa, e estava sozinho
-- num ramo OR de whatsapp_conversations_select, whatsapp_messages_select e
-- support_attendances_select. Nenhuma policy RESTRICTIVE fechava por tenant.
-- Provado em produção antes do fix, com operador como controle: operador via 0
-- registros alheios; admin e gestor viam 9 a 11 empresas. Pelo PostgREST no
-- local, um admin comum lia 606.954 mensagens de outras empresas. A tela não
-- mostrava porque o frontend sempre filtra por tenant_id.
--
-- Correção: a mesma regra, com o ramo de admin/gestor preso à própria empresa.
-- Super admin continua vendo tudo por is_super_admin(). tenant_id é NOT NULL
-- nas 3 tabelas e nenhum profile tem mais de uma empresa.
--
-- Verificado depois em produção: admin/gestor propria=t alheia=f; operador
-- igual; super admin alheia=t. Lista de conversas 7 ms, mensagens da conversa
-- 0,8 ms, atendimentos 22 ms.
-- ============================================================================
set local lock_timeout = '3s';

alter policy whatsapp_conversations_select on public.whatsapp_conversations
  using (
    (select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id())
        and ((select public.is_admin_or_head())
             or department_id = (select public.current_user_department_id())
             or department_id is null
             or is_group = true))
  );

alter policy support_attendances_select on public.support_attendances
  using (
    (select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id())
        and ((select public.is_admin_or_head())
             or department_id = (select public.current_user_department_id())
             or department_id is null
             or is_group = true))
  );

alter policy whatsapp_messages_select on public.whatsapp_messages
  using (
    (select public.is_super_admin())
    or (tenant_id = (select public.current_tenant_id()) and (select public.is_admin_or_head()))
    or exists (
      select 1 from public.whatsapp_conversations c
       where c.id = whatsapp_messages.conversation_id
         and c.tenant_id = (select public.current_tenant_id())
         and (c.is_group = true
              or c.department_id = (select public.current_user_department_id())
              or c.department_id is null
              or c.assigned_to = (select auth.uid())))
  );
