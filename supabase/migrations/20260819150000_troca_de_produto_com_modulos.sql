-- =====================================================================
-- admin_swap_cliente_produto: trocar produto deixa de exigir ficha sem modulo.
--
-- A trava antiga ("existem N modulo(s) vinculado(s). Remova-os primeiro.")
-- existia porque cliente_produto_modulos.modulo_id aponta para produto_modulos,
-- que e uma lista POR PRODUTO: trocar o produto deixaria os modulos do cliente
-- apontando para o catalogo do produto antigo.
--
-- So que na pratica os produtos irmaos tem exatamente os mesmos modulos
-- (PDV Legal, PDV Legal - Servidor, PDV Legal - Terminal...). Entao em vez de
-- barrar, a funcao agora REAPONTA cada modulo do cliente para o modulo de mesmo
-- nome no produto destino -- e so recusa quando falta algum la, dizendo qual.
--
-- Detalhes que nao sao obvios:
--   1. skip_valor_sync ligado no reaponte. Sem ele fn_sync_produto_valores
--      reescreve os valores do produto e trg_valor_enfileirar_omie enfileira o
--      contrato -- sendo que esta funcao ja enfileira o Omie no fim, de proposito.
--   2. O log de modulos (trg_log_cliente_produto_modulo) nao registra nada aqui:
--      mudar so o modulo_id nao e adicionar, cancelar nem mudar quantidade.
--   3. contrato_itens.modulo_id tambem aponta para produto_modulos e e reapontado
--      junto, senao sobra item de contrato preso ao catalogo antigo.
--   4. Comparacao por lower(btrim(nome)) -- a mesma que a tela usa para dizer,
--      antes de salvar, quais produtos aceitam a troca.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_swap_cliente_produto(
  p_cliente_produto_id uuid,
  p_novo_produto_id bigint,
  p_novo_fornecedor_id bigint DEFAULT NULL::bigint
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_is_super boolean;
  v_is_head boolean;
  v_user_tenant uuid;
  v_cp_tenant uuid;
  v_old_produto_id bigint;
  v_contrato_itens_count int;
  v_novo_produto_nome text;
  v_contrato_id uuid;
  v_enfileirados int := 0;
  v_faltando text;
  v_modulos_remap int := 0;
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

  -- Reaponte dos módulos. Só faz sentido quando o produto muda de verdade.
  IF p_novo_produto_id IS DISTINCT FROM v_old_produto_id THEN
    SELECT string_agg(DISTINCT pm_old.nome, ', ' ORDER BY pm_old.nome)
      INTO v_faltando
      FROM cliente_produto_modulos cpm
      JOIN produto_modulos pm_old ON pm_old.id = cpm.modulo_id
     WHERE cpm.cliente_produto_id = p_cliente_produto_id
       AND NOT EXISTS (
             SELECT 1
               FROM produto_modulos pm_new
              WHERE pm_new.produto_id = p_novo_produto_id
                AND pm_new.tenant_id = v_cp_tenant
                AND lower(btrim(pm_new.nome)) = lower(btrim(pm_old.nome))
           );

    IF v_faltando IS NOT NULL THEN
      RAISE EXCEPTION 'Não dá para trocar para "%": lá não existe o módulo %. Cadastre o módulo no produto destino ou cancele o do cliente antes.',
        v_novo_produto_nome, v_faltando
        USING ERRCODE = '23000';
    END IF;

    PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

    WITH destino AS (
      SELECT DISTINCT ON (lower(btrim(nome)))
             lower(btrim(nome)) AS chave, id
        FROM produto_modulos
       WHERE produto_id = p_novo_produto_id
         AND tenant_id = v_cp_tenant
       ORDER BY lower(btrim(nome)), ativo DESC, created_at
    )
    UPDATE cliente_produto_modulos cpm
       SET modulo_id  = d.id,
           updated_at = now()
      FROM produto_modulos pm_old, destino d
     WHERE cpm.cliente_produto_id = p_cliente_produto_id
       AND pm_old.id = cpm.modulo_id
       AND d.chave = lower(btrim(pm_old.nome))
       AND cpm.modulo_id <> d.id;
    GET DIAGNOSTICS v_modulos_remap = ROW_COUNT;

    WITH destino AS (
      SELECT DISTINCT ON (lower(btrim(nome)))
             lower(btrim(nome)) AS chave, id
        FROM produto_modulos
       WHERE produto_id = p_novo_produto_id
         AND tenant_id = v_cp_tenant
       ORDER BY lower(btrim(nome)), ativo DESC, created_at
    )
    UPDATE contrato_itens ci
       SET modulo_id = d.id
      FROM produto_modulos pm_old, destino d
     WHERE ci.cliente_produto_id = p_cliente_produto_id
       AND ci.modulo_id IS NOT NULL
       AND pm_old.id = ci.modulo_id
       AND d.chave = lower(btrim(pm_old.nome))
       AND ci.modulo_id <> d.id;

    PERFORM set_config('doctorsaas.skip_valor_sync', '', true);
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

  -- 04/08/2026: o Omie precisa saber. Ver cabeçalho da migration.
  -- Sai só se o produto MUDOU de verdade: revincular o mesmo produto (ou trocar apenas o
  -- fornecedor, que o Omie não conhece) não tem o que sincronizar.
  IF p_novo_produto_id IS DISTINCT FROM v_old_produto_id THEN
    FOR v_contrato_id IN
      SELECT DISTINCT ci.contrato_id
        FROM contrato_itens ci
        JOIN contratos c ON c.id = ci.contrato_id
       WHERE ci.cliente_produto_id = p_cliente_produto_id
         AND c.tenant_id = v_cp_tenant
         AND c.status = 'ativo'
    LOOP
      PERFORM public.enfileirar_sync_omie(v_contrato_id, 'produto');
      v_enfileirados := v_enfileirados + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'cliente_produto_id', p_cliente_produto_id,
    'old_produto_id', v_old_produto_id,
    'new_produto_id', p_novo_produto_id,
    'novo_produto_nome', v_novo_produto_nome,
    'contrato_itens_atualizados', v_contrato_itens_count,
    'modulos_reapontados', v_modulos_remap,
    'omie_contratos_enfileirados', v_enfileirados
  );
END;
$$;
