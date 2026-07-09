
CREATE OR REPLACE FUNCTION public.reconciliacao_fornecedores_count(p_tenant_id uuid)
RETURNS TABLE(fornecedor_ds text, qtd bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fornecedor_ds, COUNT(*)::bigint AS qtd
  FROM public.reconciliacao_cadastro
  WHERE tenant_id = p_tenant_id
  GROUP BY fornecedor_ds
  ORDER BY COUNT(*) DESC;
$$;

GRANT EXECUTE ON FUNCTION public.reconciliacao_fornecedores_count(uuid) TO authenticated, service_role;
