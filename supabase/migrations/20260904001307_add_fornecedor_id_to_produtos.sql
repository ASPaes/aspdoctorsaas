-- Fornecedor padrao do produto.
-- Aplicada em producao em 03/09/2026 (version 20260904001307).
-- Aditiva e opcional: nenhum produto existente foi preenchido (sem backfill,
-- decisao do owner). A amarracao e SUGESTAO, nao trava -- na base ha produto
-- atendido por mais de um fornecedor (PDV Legal, ASP Sistemas, VHSys).
ALTER TABLE public.produtos
  ADD COLUMN IF NOT EXISTS fornecedor_id bigint
  REFERENCES public.fornecedores(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.produtos.fornecedor_id IS
  'Fornecedor padrao do produto. Sugestao para o lancamento em cliente_produtos: preenche o campo apenas quando ele esta vazio, nunca sobrescreve escolha manual.';
