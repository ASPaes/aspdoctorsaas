-- Troca de produto do cliente passa a enfileirar sincronização com o Omie.
--
-- O BURACO (defeito 4 da revisão de processo da fila, DEM-0237, 03/08/2026)
--   `admin_swap_cliente_produto` troca `cliente_produtos.produto_id` e reescreve a descrição em
--   `contrato_itens` -- e não chamava `enfileirar_sync_omie`. Nenhuma linha na fila, nenhum log,
--   nenhum erro. O contrato seguia no Omie com a CATEGORIA do produto antigo para sempre, o que
--   significa receita caindo na categoria errada do DRE e, quando o serviço fiscal do produto
--   estiver preenchido, NF com o código de serviço do produto anterior.
--
--   Os outros caminhos já enfileiravam: cadastro do cliente (trg_cliente_cadastro_enfileirar_omie),
--   status (trg_contrato_status_enfileirar_omie), movimentos de MRR
--   (trg_movimento_mrr_enfileirar_omie) e valor/módulos (trg_valor_enfileirar_omie, 03/08).
--   A troca de produto era o único que mexia no contrato sem avisar ninguém.
--
-- POR QUE AQUI E NÃO NUM GATILHO
--   Um gatilho em `cliente_produtos.produto_id` pegaria qualquer caminho, inclusive UPDATE manual
--   por SQL. Mas `produto_id` também é escrito na criação do produto do cliente, quando ainda não
--   existe contrato -- e o gatilho de valor já cobre o que importa depois disso. A troca em si só
--   acontece por esta RPC (é a única que altera `produto_id` de um cliente_produto existente, e
--   ela é gate de admin/head/super). Enfileirar aqui mantém o escopo exato da operação.
--
-- origem='produto', sem p_campos -- as duas decisões importam:
--   * NÃO entra em ORIGENS_COM_SITUACAO (churn, reativacao) do omie-sync-processar, então nenhuma
--     situação viaja: uma troca de produto não pode cancelar nem reativar contrato nenhum.
--   * `campos_alterados` fica NULL, então (v10) `dVigFinal` NÃO é escrita -- evita repetir o
--     incidente de 13/07 (vigência final no passado faz o contrato parar de faturar) -- e (v11) o
--     cadastro do cliente não é empurrado por cima do Omie.
--   O que efetivamente muda no Omie é a categoria (e o serviço fiscal, quando houver), que o
--   ds-omie-contrato-alterar v14 aplica sozinho ao detectar produto diferente do espelho.
--
-- Só contrato ATIVO: contrato cancelado traduziria para operação 'cancelar' no
-- montar_payload_contrato_omie e mandaria um cancelamento que ninguém pediu.
--
-- Idempotente por contrato: enfileirar_sync_omie coalesce a linha pendente, então N trocas
-- seguidas viram 1 envio.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

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
  v_contrato_id uuid;          -- 04/08/2026: enfileiramento Omie
  v_enfileirados int := 0;     -- 04/08/2026: volta no retorno, para a tela poder confirmar
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
    'omie_contratos_enfileirados', v_enfileirados
  );
END;
$function$;

COMMIT;
