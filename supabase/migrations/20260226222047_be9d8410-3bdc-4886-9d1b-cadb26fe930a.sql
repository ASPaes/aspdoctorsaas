
CREATE TABLE public.cac_despesas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid,
  mes_inicial date NOT NULL,
  mes_final date,
  ativo boolean NOT NULL DEFAULT true,
  categoria text NOT NULL,
  descricao text NOT NULL,
  valor_total numeric NOT NULL,
  percentual_alocado_vendas numeric,
  valor_alocado numeric NOT NULL,
  unidade_base_id bigint REFERENCES public.unidades_base(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cac_despesas ENABLE ROW LEVEL SECURITY;

CREATE POLICY cac_despesas_tenant_rw ON public.cac_despesas
  FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

CREATE TRIGGER set_tenant_id_cac_despesas
  BEFORE INSERT ON public.cac_despesas
  FOR EACH ROW
  EXECUTE FUNCTION set_tenant_id_on_insert();
