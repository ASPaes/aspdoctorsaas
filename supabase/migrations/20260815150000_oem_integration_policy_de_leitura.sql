-- ============================================================================
-- "Nenhuma conta conectada ainda" com conta conectada — a lista nunca podia
-- funcionar.
--
-- A migration de 14/08 ligou RLS em oem_integration e NÃO criou policy nenhuma,
-- com o comentário "Sem grant para authenticated: nem a linha, nem o ponteiro
-- do Vault". A tela lê a view oem_integration_status, que está com
-- `security_invoker = on` — ou seja, ela roda com os direitos de quem chama.
-- RLS ligada + zero policy = zero linha, sempre, para qualquer usuário.
--
-- E o "sem grant" não era verdade: o banco tem
--   alter default privileges for role postgres in schema public
--     grant all on tables to anon, authenticated;
-- então a tabela nasceu com GRANT ALL para anon e authenticated. Hoje só a RLS
-- sem policy estava segurando — proteção por acidente, não por desenho.
--
-- O MODELO É O DO OMIE, que funciona há meses: omie_integration não tem view
-- nenhuma, tem policy de SELECT com
--   is_super_admin() or (tenant_id = current_tenant_id() and is_tenant_admin_or_head())
-- É essa policy que falta aqui.
--
-- Um passo além do Omie: em vez de deixar GRANT ALL na tabela, o acesso é por
-- COLUNA. `vault_secret_id` fica de fora — o ponteiro do cofre não precisa
-- chegar ao navegador para a tela desenhar, e é exatamente o conjunto de
-- colunas que a view já expõe.
-- ============================================================================

begin;

-- 1. o grant que veio do default privilege sai, inclusive de anon
revoke all on table public.oem_integration from anon, authenticated;

-- 2. volta só o que a view precisa — sem vault_secret_id e sem criado_por
grant select (
  id, tenant_id, unidades_base_ids, chave_prefixo, api_url, ativo,
  ultimo_status, ultimo_teste_at, ultimo_sync_em, ultimo_sync_status,
  ultimo_sync_msg, criado_em
) on public.oem_integration to authenticated;

-- 3. a policy que faltava, igual à do Omie
drop policy if exists oem_integration_select on public.oem_integration;
create policy oem_integration_select on public.oem_integration
  for select to authenticated
  using (
    public.is_super_admin()
    or (tenant_id = public.current_tenant_id() and public.is_tenant_admin_or_head())
  );

-- Escrita continua só pela RPC salvar_chave_oem (security definer, com portão
-- de admin por dentro). Sem policy de insert/update/delete de propósito.

commit;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura)
--
--   select polname, polcmd from pg_policy
--    where polrelid = 'public.oem_integration'::regclass;
--   -- esperado: oem_integration_select | r
--
--   select column_name, privilege_type
--     from information_schema.column_privileges
--    where table_name = 'oem_integration' and grantee = 'authenticated'
--    order by 1;
--   -- esperado: as 12 colunas da view, e vault_secret_id NÃO na lista
--
--   select count(*) from public.oem_integration_status;
--   -- pelo SQL Editor roda como postgres e conta tudo; a prova de verdade é a
--   -- tela mostrar a conta em Integrações › OEM › Conexão.
-- ---------------------------------------------------------------------------
