
-- Fix unique constraints to be per-tenant instead of global
-- Use ALTER TABLE DROP CONSTRAINT for constraints backed by indexes

-- fornecedores
ALTER TABLE public.fornecedores DROP CONSTRAINT IF EXISTS fornecedores_nome_key;
CREATE UNIQUE INDEX fornecedores_tenant_nome_uniq ON public.fornecedores (tenant_id, nome);

-- areas_atuacao
ALTER TABLE public.areas_atuacao DROP CONSTRAINT IF EXISTS areas_atuacao_nome_key;
CREATE UNIQUE INDEX areas_atuacao_tenant_nome_uniq ON public.areas_atuacao (tenant_id, nome);

-- formas_pagamento
ALTER TABLE public.formas_pagamento DROP CONSTRAINT IF EXISTS formas_pagamento_nome_key;
CREATE UNIQUE INDEX formas_pagamento_tenant_nome_uniq ON public.formas_pagamento (tenant_id, nome);

-- segmentos
ALTER TABLE public.segmentos DROP CONSTRAINT IF EXISTS segmentos_nome_key;
CREATE UNIQUE INDEX segmentos_tenant_nome_uniq ON public.segmentos (tenant_id, nome);

-- modelos_contrato (old name: verticais)
ALTER TABLE public.modelos_contrato DROP CONSTRAINT IF EXISTS verticais_nome_key;
CREATE UNIQUE INDEX modelos_contrato_tenant_nome_uniq ON public.modelos_contrato (tenant_id, nome);

-- motivos_cancelamento
ALTER TABLE public.motivos_cancelamento DROP CONSTRAINT IF EXISTS motivos_cancelamento_descricao_key;
CREATE UNIQUE INDEX motivos_cancelamento_tenant_descricao_uniq ON public.motivos_cancelamento (tenant_id, descricao);

-- funcionarios: remove old global email unique (tenant-scoped one already exists)
ALTER TABLE public.funcionarios DROP CONSTRAINT IF EXISTS funcionarios_email_key;
