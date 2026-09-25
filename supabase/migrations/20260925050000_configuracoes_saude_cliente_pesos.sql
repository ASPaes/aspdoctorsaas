-- Pesos da nota de saúde do cliente (Clientes › Visão 360°), por empresa.
-- Editados em Configurações › Saúde do cliente. NULL = padrão da plataforma
-- (25/15/25/20/15), definido no frontend em PESOS_SAUDE_PADRAO.
-- Coluna nula e sem default: só catálogo, não reescreve a tabela.
-- Leitura e escrita seguem a policy que já existe em configuracoes.
alter table public.configuracoes add column if not exists saude_cliente_pesos jsonb;

comment on column public.configuracoes.saude_cliente_pesos is
  'Pesos da nota de saúde do cliente: {"satisfacao","engajamento","financeiro","suporte","receita"} em %, somando 100. NULL = padrão.';
