-- Drop global unique constraint on cnpj
ALTER TABLE public.clientes DROP CONSTRAINT IF EXISTS clientes_cnpj_key;

-- Create tenant-scoped unique index
CREATE UNIQUE INDEX clientes_tenant_cnpj_uniq ON public.clientes (tenant_id, cnpj) WHERE cnpj IS NOT NULL;