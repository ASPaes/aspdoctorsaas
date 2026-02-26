-- Restrict catalog table SELECT policies to tenant-scoped access

DROP POLICY IF EXISTS areas_atuacao_read ON public.areas_atuacao;
CREATE POLICY areas_atuacao_read ON public.areas_atuacao
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS segmentos_read ON public.segmentos;
CREATE POLICY segmentos_read ON public.segmentos
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS modelos_contrato_read ON public.modelos_contrato;
CREATE POLICY modelos_contrato_read ON public.modelos_contrato
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS fornecedores_read ON public.fornecedores;
CREATE POLICY fornecedores_read ON public.fornecedores
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS produtos_read ON public.produtos;
CREATE POLICY produtos_read ON public.produtos
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS formas_pagamento_read ON public.formas_pagamento;
CREATE POLICY formas_pagamento_read ON public.formas_pagamento
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS motivos_cancelamento_read ON public.motivos_cancelamento;
CREATE POLICY motivos_cancelamento_read ON public.motivos_cancelamento
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS origens_venda_read ON public.origens_venda;
CREATE POLICY origens_venda_read ON public.origens_venda
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());

DROP POLICY IF EXISTS unidades_base_read ON public.unidades_base;
CREATE POLICY unidades_base_read ON public.unidades_base
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin());
