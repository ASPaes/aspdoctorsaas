-- ⛔ NÃO APLICADA EM PRODUÇÃO — decisão de 17/09/2026, na noite da publicação.
--
-- Medido em produção ANTES de aplicar: as chaves `tickets`, `fin.mrr` e
-- `clientes.contratos` nasceram nesta entrega e NÃO têm linha de papel nenhuma,
-- então a cadeia termina em `false` para TODO MUNDO — inclusive administradores,
-- nas 10 empresas com RBAC ligado. Como estas policies são RESTRICTIVE, elas
-- passariam a barrar a leitura das tabelas: a tela de Tickets, os contratos e o
-- MRR morreriam para ~100 pessoas.
--
-- A foto de acesso NÃO pega isto: ela mede permissão de tela, e aqui o que muda
-- é leitura de tabela (RLS).
--
-- Para aplicar um dia: primeiro semear `role_permissions` / `tenant_role_permissions`
-- das chaves usadas por estas policies, espelhando o acesso de hoje (foi o que a
-- migration 20260917230000 fez para `tickets`), e só então ligar as policies —
-- uma tabela por vez, medindo entre cada uma.
--
-- ============================================================================
-- F4 — a permissão passa a valer DENTRO do banco
--
-- Ate aqui o RBAC era cadeado de tela: quem chamasse o PostgREST direto lia
-- tudo do proprio tenant. Estas policies fecham isso nas tabelas que carregam
-- dado sensivel.
--
-- REGRAS QUE NAO PODEM SER QUEBRADAS:
--  · `AS RESTRICTIVE` sempre. Policy PERMISSIVE soma com OU e AMPLIA o acesso,
--    em silencio. As 20 policies de unidade que ja rodam em producao acertaram.
--  · `(SELECT has_perm(...))` sempre, para virar InitPlan e rodar 1x por
--    consulta em vez de 1x por linha. 254 das 466 policies ja usam esse padrao.
--  · `TO authenticated`: service_role e postgres tem BYPASSRLS, entao edge
--    functions e rotinas internas seguem intactas.
--
-- QUEM NAO E AFETADO, por construcao de has_perm():
--  · super admin (retorna true antes de qualquer consulta)
--  · tenant com rbac_enabled = false (retorna true)
-- ============================================================================
begin;

-- ---------------------------------------------------------------- índices
-- Antes das policies, nunca depois. CONCURRENTLY nao roda em transacao, entao
-- em producao estes tres saem por execute_sql, fora do pico.
create index if not exists idx_wa_conv_tenant_dept    on public.whatsapp_conversations (tenant_id, department_id);
create index if not exists idx_wa_conv_tenant_assign  on public.whatsapp_conversations (tenant_id, assigned_to);
create index if not exists idx_tickets_tenant_dept    on public.support_tickets (tenant_id, department_id);

-- ------------------------------------------------------------- CLIENTES
drop policy if exists rbac_clientes_select on public.clientes;
create policy rbac_clientes_select on public.clientes
  as restrictive for select to authenticated
  using ((select public.has_perm('clientes','view')));

drop policy if exists rbac_clientes_delete on public.clientes;
create policy rbac_clientes_delete on public.clientes
  as restrictive for delete to authenticated
  using ((select public.has_perm('clientes','delete')));

-- ------------------------------------------------------------ CONTRATOS
drop policy if exists rbac_contratos_select on public.contratos;
create policy rbac_contratos_select on public.contratos
  as restrictive for select to authenticated
  using ((select public.has_perm('clientes.contratos','view')));

-- --------------------------------------------------------- MRR / RECEITA
drop policy if exists rbac_mrr_select on public.movimentos_mrr;
create policy rbac_mrr_select on public.movimentos_mrr
  as restrictive for select to authenticated
  using ((select public.has_perm('fin.mrr','view')));

-- -------------------------------------------------------------- PRODUTOS
drop policy if exists rbac_produtos_select on public.produtos;
create policy rbac_produtos_select on public.produtos
  as restrictive for select to authenticated
  using ((select public.has_perm('cfg.produtos','view')));

-- Apagar produto mexe em contrato e em MRR: exige a acao `delete`, nao so ver.
drop policy if exists rbac_produtos_delete on public.produtos;
create policy rbac_produtos_delete on public.produtos
  as restrictive for delete to authenticated
  using ((select public.has_perm('cfg.produtos','delete')));

-- ------------------------------------------------------ CHAT (LGPD, 387k)
drop policy if exists rbac_conversas_select on public.whatsapp_conversations;
create policy rbac_conversas_select on public.whatsapp_conversations
  as restrictive for select to authenticated
  using ((select public.has_perm('atendimento_chat','view')));

-- `whatsapp_messages` so tem conversation_id e 387 mil linhas: aqui vale a
-- permissao, e o escopo fica na CONVERSA (a mensagem so e alcancada por ela).
drop policy if exists rbac_mensagens_select on public.whatsapp_messages;
create policy rbac_mensagens_select on public.whatsapp_messages
  as restrictive for select to authenticated
  using ((select public.has_perm('atendimento_chat','view')));

-- --------------------------------------------------------------- TICKETS
drop policy if exists rbac_tickets_select on public.support_tickets;
create policy rbac_tickets_select on public.support_tickets
  as restrictive for select to authenticated
  using ((select public.has_perm('tickets','view')));

drop policy if exists rbac_tickets_delete on public.support_tickets;
create policy rbac_tickets_delete on public.support_tickets
  as restrictive for delete to authenticated
  using ((select public.has_perm('tickets.excluir','view')));

commit;
