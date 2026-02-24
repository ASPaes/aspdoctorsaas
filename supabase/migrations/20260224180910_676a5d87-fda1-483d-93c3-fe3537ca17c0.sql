
DO $$ BEGIN
  CREATE TYPE movimento_mrr_tipo AS ENUM ('upsell', 'cross_sell', 'downsell', 'venda_avulsa');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.movimentos_mrr (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id),
  tipo movimento_mrr_tipo NOT NULL,
  data_movimento date NOT NULL,
  valor_delta numeric NOT NULL DEFAULT 0,
  custo_delta numeric NOT NULL DEFAULT 0,
  valor_venda_avulsa numeric,
  origem_venda text,
  descricao text,
  funcionario_id bigint REFERENCES public.funcionarios(id),
  status text NOT NULL DEFAULT 'ativo',
  estorno_de uuid REFERENCES public.movimentos_mrr(id),
  estornado_por uuid REFERENCES public.movimentos_mrr(id),
  inativado_em timestamptz,
  inativado_por_id bigint REFERENCES public.funcionarios(id),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimentos_mrr_cliente_id ON public.movimentos_mrr(cliente_id);

ALTER TABLE public.movimentos_mrr ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_movimentos_mrr"
  ON public.movimentos_mrr
  FOR SELECT
  USING (true);

CREATE POLICY "auth_write_movimentos_mrr"
  ON public.movimentos_mrr
  FOR ALL
  USING (true)
  WITH CHECK (true);
