
ALTER TABLE public.verticais RENAME TO modelos_contrato;
ALTER TABLE public.clientes RENAME COLUMN vertical_id TO modelo_contrato_id;
CREATE INDEX IF NOT EXISTS idx_clientes_modelo_contrato ON public.clientes (modelo_contrato_id);
