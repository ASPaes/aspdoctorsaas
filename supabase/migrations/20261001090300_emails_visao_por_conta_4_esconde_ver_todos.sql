-- =============================================================================
-- E-mails — "Ver e-mails de todas as pessoas" sai da matriz de permissões
--
-- Desde 01/10/2026 nenhuma regra (RLS, RPC, tela) consulta email.ver_todos: a
-- leitura vai pela conta e pelas 4 permissões novas (ver 1/3). A chave fica no
-- catálogo, escondida, para as linhas de permissão que apontam para ela não
-- quebrarem a chave estrangeira.
-- =============================================================================

begin;
update public.resources set hidden = true where key = 'email.ver_todos';
commit;
