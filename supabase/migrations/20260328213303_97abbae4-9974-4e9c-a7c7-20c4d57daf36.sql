ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS complemento text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS dia_vencimento_mrr integer;