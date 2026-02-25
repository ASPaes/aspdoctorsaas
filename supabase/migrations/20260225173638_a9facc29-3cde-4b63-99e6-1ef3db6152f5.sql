
DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM public.tenants WHERE nome='ASP' LIMIT 1;

  UPDATE public.clientes SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.cs_tickets SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.movimentos_mrr SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.certificado_a1_vendas SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.cliente_contatos SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.cs_ticket_updates SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.cs_ticket_reassignments SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.configuracoes SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.funcionarios SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.segmentos SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.areas_atuacao SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.modelos_contrato SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.fornecedores SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.produtos SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.formas_pagamento SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.motivos_cancelamento SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.origens_venda SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
  UPDATE public.unidades_base SET tenant_id = v_tenant_id WHERE tenant_id IS NULL;
END $$;
