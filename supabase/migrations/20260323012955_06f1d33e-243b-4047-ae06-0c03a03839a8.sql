
CREATE TABLE public.cliente_avaliacoes_atendimento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  contact_id uuid,
  avaliado_por uuid,
  nota integer,
  sentimento text,
  resumo text NOT NULL,
  pontos_chave text[],
  itens_acao text[],
  periodo_inicio timestamptz,
  periodo_fim timestamptz,
  total_mensagens integer DEFAULT 0,
  total_conversas integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cliente_avaliacoes_atendimento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_avaliacoes_atendimento FORCE ROW LEVEL SECURITY;

CREATE POLICY "cliente_avaliacoes_tenant_rw" ON public.cliente_avaliacoes_atendimento
  FOR ALL TO authenticated
  USING (can_access_tenant_row(tenant_id))
  WITH CHECK (can_access_tenant_row(tenant_id));

CREATE TRIGGER set_tenant_id_on_insert_cliente_avaliacoes
  BEFORE INSERT ON public.cliente_avaliacoes_atendimento
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

CREATE INDEX idx_cliente_avaliacoes_cliente_id ON public.cliente_avaliacoes_atendimento(cliente_id);
CREATE INDEX idx_cliente_avaliacoes_tenant_id ON public.cliente_avaliacoes_atendimento(tenant_id);
