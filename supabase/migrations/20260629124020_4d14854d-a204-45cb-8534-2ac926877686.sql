CREATE OR REPLACE FUNCTION public.admin_swap_cliente_produto(p_cliente_produto_id uuid, p_novo_produto_id bigint, p_novo_fornecedor_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_super boolean;
  v_is_head boolean;
  v_user_tenant uuid;
  v_cp_tenant uuid;
  v_old_produto_id bigint;
  v_modulos_count int;
  v_contrato_itens_count int;
  v_novo_produto_nome text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado' USING ERRCODE = '42501';
  END IF;

  v_is_super := public.is_super_admin();
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND role = 'head'
      AND access_status = 'active'
      AND status = 'ativo'
  ) INTO v_is_head;

  IF NOT v_is_super AND NOT public.is_tenant_admin() AND NOT v_is_head THEN
    RAISE EXCEPTION 'Apenas super admin, admin ou head do tenant pode trocar produto de um cliente_produto'
      USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id, produto_id INTO v_cp_tenant, v_old_produto_id
  FROM cliente_produtos
  WHERE id = p_cliente_produto_id;

  IF v_cp_tenant IS NULL THEN
    RAISE EXCEPTION 'cliente_produto % não encontrado', p_cliente_produto_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_super THEN
    SELECT tenant_id INTO v_user_tenant
    FROM profiles
    WHERE user_id = auth.uid();

    IF v_user_tenant IS NULL OR v_user_tenant <> v_cp_tenant THEN
      RAISE EXCEPTION 'Sem permissão para alterar este cliente_produto (outro tenant)'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_modulos_count
  FROM cliente_produto_modulos
  WHERE cliente_produto_id = p_cliente_produto_id;

  IF v_modulos_count > 0 THEN
    RAISE EXCEPTION 'Não é possível trocar produto: existem % módulo(s) vinculado(s). Remova-os primeiro.', v_modulos_count
      USING ERRCODE = '23000';
  END IF;

  SELECT nome INTO v_novo_produto_nome
  FROM produtos
  WHERE id = p_novo_produto_id AND tenant_id = v_cp_tenant;

  IF v_novo_produto_nome IS NULL THEN
    RAISE EXCEPTION 'Produto % não encontrado ou pertence a outro tenant', p_novo_produto_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_novo_fornecedor_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM fornecedores
      WHERE id = p_novo_fornecedor_id AND tenant_id = v_cp_tenant
    ) THEN
      RAISE EXCEPTION 'Fornecedor % não encontrado ou pertence a outro tenant', p_novo_fornecedor_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE cliente_produtos
  SET produto_id = p_novo_produto_id,
      fornecedor_id = COALESCE(p_novo_fornecedor_id, fornecedor_id),
      updated_at = now()
  WHERE id = p_cliente_produto_id;

  UPDATE contrato_itens
  SET descricao = v_novo_produto_nome
  WHERE cliente_produto_id = p_cliente_produto_id;

  GET DIAGNOSTICS v_contrato_itens_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'cliente_produto_id', p_cliente_produto_id,
    'old_produto_id', v_old_produto_id,
    'new_produto_id', p_novo_produto_id,
    'novo_produto_nome', v_novo_produto_nome,
    'contrato_itens_atualizados', v_contrato_itens_count
  );
END;
$function$;