
-- Transacionais
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON public.clientes(tenant_id);

ALTER TABLE public.cs_tickets ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_cs_tickets_tenant_id ON public.cs_tickets(tenant_id);

ALTER TABLE public.movimentos_mrr ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_movimentos_mrr_tenant_id ON public.movimentos_mrr(tenant_id);

ALTER TABLE public.certificado_a1_vendas ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_cert_a1_tenant_id ON public.certificado_a1_vendas(tenant_id);

ALTER TABLE public.cliente_contatos ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_cliente_contatos_tenant_id ON public.cliente_contatos(tenant_id);

ALTER TABLE public.cs_ticket_updates ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_cs_ticket_updates_tenant_id ON public.cs_ticket_updates(tenant_id);

ALTER TABLE public.cs_ticket_reassignments ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_cs_ticket_reassignments_tenant_id ON public.cs_ticket_reassignments(tenant_id);

ALTER TABLE public.configuracoes ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_configuracoes_tenant_id ON public.configuracoes(tenant_id);

ALTER TABLE public.funcionarios ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_funcionarios_tenant_id ON public.funcionarios(tenant_id);

-- Catálogos/lookup
ALTER TABLE public.segmentos ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_segmentos_tenant_id ON public.segmentos(tenant_id);

ALTER TABLE public.areas_atuacao ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_areas_atuacao_tenant_id ON public.areas_atuacao(tenant_id);

ALTER TABLE public.modelos_contrato ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_modelos_contrato_tenant_id ON public.modelos_contrato(tenant_id);

ALTER TABLE public.fornecedores ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_fornecedores_tenant_id ON public.fornecedores(tenant_id);

ALTER TABLE public.produtos ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_tenant_id ON public.produtos(tenant_id);

ALTER TABLE public.formas_pagamento ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_formas_pagamento_tenant_id ON public.formas_pagamento(tenant_id);

ALTER TABLE public.motivos_cancelamento ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_motivos_cancelamento_tenant_id ON public.motivos_cancelamento(tenant_id);

ALTER TABLE public.origens_venda ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_origens_venda_tenant_id ON public.origens_venda(tenant_id);

ALTER TABLE public.unidades_base ADD COLUMN IF NOT EXISTS tenant_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_unidades_base_tenant_id ON public.unidades_base(tenant_id);
