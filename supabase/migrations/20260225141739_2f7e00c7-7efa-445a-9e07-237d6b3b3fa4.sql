-- Performance indexes for commonly filtered/sorted columns on clientes table
CREATE INDEX IF NOT EXISTS idx_clientes_cancelado ON public.clientes (cancelado);
CREATE INDEX IF NOT EXISTS idx_clientes_data_cadastro ON public.clientes (data_cadastro);
CREATE INDEX IF NOT EXISTS idx_clientes_data_venda ON public.clientes (data_venda);
CREATE INDEX IF NOT EXISTS idx_clientes_segmento_id ON public.clientes (segmento_id);
CREATE INDEX IF NOT EXISTS idx_clientes_modelo_contrato_id ON public.clientes (modelo_contrato_id);
CREATE INDEX IF NOT EXISTS idx_clientes_funcionario_id ON public.clientes (funcionario_id);
CREATE INDEX IF NOT EXISTS idx_clientes_origem_venda_id ON public.clientes (origem_venda_id);
CREATE INDEX IF NOT EXISTS idx_clientes_unidade_base_id ON public.clientes (unidade_base_id);
CREATE INDEX IF NOT EXISTS idx_clientes_produto_id ON public.clientes (produto_id);
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj ON public.clientes (cnpj);
CREATE INDEX IF NOT EXISTS idx_clientes_razao_social_trgm ON public.clientes USING btree (razao_social);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo_sequencial ON public.clientes (codigo_sequencial);

-- Composite index for the most common listing query (active clients sorted by name)
CREATE INDEX IF NOT EXISTS idx_clientes_cancelado_razao ON public.clientes (cancelado, razao_social);

-- Index for certificado_a1_vendas lookups
CREATE INDEX IF NOT EXISTS idx_cert_a1_vendas_cliente_status ON public.certificado_a1_vendas (cliente_id, status);

-- Index for movimentos_mrr lookups
CREATE INDEX IF NOT EXISTS idx_movimentos_mrr_cliente ON public.movimentos_mrr (cliente_id, status);