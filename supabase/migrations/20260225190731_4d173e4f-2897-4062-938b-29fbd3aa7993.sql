
-- Catálogos: leitura global para authenticated, escrita restrita ao tenant

-- areas_atuacao
DROP POLICY IF EXISTS areas_atuacao_tenant_rw ON public.areas_atuacao;
CREATE POLICY areas_atuacao_read ON public.areas_atuacao FOR SELECT TO authenticated USING (true);
CREATE POLICY areas_atuacao_write ON public.areas_atuacao FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- segmentos
DROP POLICY IF EXISTS segmentos_tenant_rw ON public.segmentos;
CREATE POLICY segmentos_read ON public.segmentos FOR SELECT TO authenticated USING (true);
CREATE POLICY segmentos_write ON public.segmentos FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- modelos_contrato
DROP POLICY IF EXISTS modelos_contrato_tenant_rw ON public.modelos_contrato;
CREATE POLICY modelos_contrato_read ON public.modelos_contrato FOR SELECT TO authenticated USING (true);
CREATE POLICY modelos_contrato_write ON public.modelos_contrato FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- fornecedores
DROP POLICY IF EXISTS fornecedores_tenant_rw ON public.fornecedores;
CREATE POLICY fornecedores_read ON public.fornecedores FOR SELECT TO authenticated USING (true);
CREATE POLICY fornecedores_write ON public.fornecedores FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- produtos
DROP POLICY IF EXISTS produtos_tenant_rw ON public.produtos;
CREATE POLICY produtos_read ON public.produtos FOR SELECT TO authenticated USING (true);
CREATE POLICY produtos_write ON public.produtos FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- formas_pagamento
DROP POLICY IF EXISTS formas_pagamento_tenant_rw ON public.formas_pagamento;
CREATE POLICY formas_pagamento_read ON public.formas_pagamento FOR SELECT TO authenticated USING (true);
CREATE POLICY formas_pagamento_write ON public.formas_pagamento FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- motivos_cancelamento
DROP POLICY IF EXISTS motivos_cancelamento_tenant_rw ON public.motivos_cancelamento;
CREATE POLICY motivos_cancelamento_read ON public.motivos_cancelamento FOR SELECT TO authenticated USING (true);
CREATE POLICY motivos_cancelamento_write ON public.motivos_cancelamento FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- origens_venda
DROP POLICY IF EXISTS origens_venda_tenant_rw ON public.origens_venda;
CREATE POLICY origens_venda_read ON public.origens_venda FOR SELECT TO authenticated USING (true);
CREATE POLICY origens_venda_write ON public.origens_venda FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- unidades_base
DROP POLICY IF EXISTS unidades_base_tenant_rw ON public.unidades_base;
CREATE POLICY unidades_base_read ON public.unidades_base FOR SELECT TO authenticated USING (true);
CREATE POLICY unidades_base_write ON public.unidades_base FOR ALL TO authenticated
  USING (tenant_id = current_tenant_id() OR is_super_admin())
  WITH CHECK (tenant_id = current_tenant_id() OR is_super_admin());

-- funcionarios (manter per-tenant - cada empresa tem seus funcionários)
-- Não alterado
