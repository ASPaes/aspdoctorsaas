-- =====================================================================
-- cancel_cliente_produto: os módulos passam a acompanhar o produto.
--
-- Hoje só o ramo "único item do contrato" inativa módulo — e por tabela,
-- dentro de cancelar_contrato. Saindo de um contrato com outros itens, ou
-- sem contrato nenhum, o produto ficava inativo com os módulos ativos
-- pendurados nele.
--
-- Três detalhes que a versão nova respeita:
--   1. skip_valor_sync ligado durante a escrita nos módulos. Sem ele,
--      fn_sync_produto_valores reescreve vlr_mensal/vlr_custo do produto e
--      trg_valor_enfileirar_omie manda o contrato do cliente para o Omie.
--      É o mesmo silêncio que cancelar_contrato já usa.
--   2. cancelado_manual = true, igual fn_cancelar_modulo_cliente faz. Sem
--      isso a próxima carga do espelho do OEM ressuscita o módulo.
--   3. O log (trg_log_cliente_produto_modulo) NÃO obedece ao skip, então o
--      "Histórico de módulos" registra o cancelamento normalmente.
--
-- Também troca CURRENT_DATE (data UTC — depois das 21h em SP já é amanhã)
-- pela data de São Paulo, e devolve modulos_inativados no jsonb.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cancel_cliente_produto(
  p_cliente_produto_id uuid,
  p_motivo_id bigint,
  p_observacao text DEFAULT NULL::text
) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_cp record;
  v_contrato_id uuid;
  v_is_implicit boolean;
  v_itens_count integer;
  v_user_tenant uuid;
  v_result jsonb;
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_motivo text := coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), 'Cancelamento do produto');
  v_modulos integer := 0;
BEGIN
  SELECT * INTO v_cp FROM cliente_produtos WHERE id = p_cliente_produto_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'cliente_produto nao encontrado';
  END IF;

  SELECT tenant_id INTO v_user_tenant FROM profiles WHERE user_id = auth.uid();
  IF NOT public.is_super_admin() AND (v_user_tenant IS NULL OR v_user_tenant <> v_cp.tenant_id) THEN
    RAISE EXCEPTION 'Sem permissao no tenant do cliente_produto';
  END IF;

  -- NOVO: módulos saem junto com o produto, antes de qualquer ramo — assim o
  -- comportamento é o mesmo com contrato de um item, de vários ou sem contrato.
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  UPDATE cliente_produto_modulos
     SET ativo               = false,
         data_inativacao     = v_hoje,
         cancelado_manual    = true,
         cancelamento_motivo = coalesce(cancelamento_motivo, v_motivo),
         cancelado_em        = now(),
         cancelado_por       = auth.uid(),
         updated_at          = now()
   WHERE cliente_produto_id = p_cliente_produto_id
     AND ativo = true;
  GET DIAGNOSTICS v_modulos = ROW_COUNT;

  PERFORM set_config('doctorsaas.skip_valor_sync', '', true);

  SELECT ci.contrato_id, c.is_implicit
  INTO v_contrato_id, v_is_implicit
  FROM contrato_itens ci
  JOIN contratos c ON c.id = ci.contrato_id
  WHERE ci.cliente_produto_id = p_cliente_produto_id
  LIMIT 1;

  IF v_contrato_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_itens_count FROM contrato_itens WHERE contrato_id = v_contrato_id;

    IF v_itens_count <= 1 THEN
      PERFORM public.cancelar_contrato(v_contrato_id, p_motivo_id, p_observacao);
      v_result := jsonb_build_object('contrato_cancelado', true, 'contrato_id', v_contrato_id);
    ELSE
      DELETE FROM contrato_itens WHERE cliente_produto_id = p_cliente_produto_id;
      UPDATE contratos c
      SET
        vlr_total_mensal = (SELECT COALESCE(SUM(vlr_mensal), 0) FROM contrato_itens WHERE contrato_id = c.id),
        vlr_total_ativacao = (SELECT COALESCE(SUM(vlr_ativacao), 0) FROM contrato_itens WHERE contrato_id = c.id),
        updated_at = now()
      WHERE c.id = v_contrato_id;
      v_result := jsonb_build_object('contrato_cancelado', false, 'contrato_id', v_contrato_id, 'item_removido', true);
    END IF;
  ELSE
    v_result := jsonb_build_object('contrato_cancelado', false, 'sem_contrato', true);
  END IF;

  UPDATE cliente_produtos
  SET ativo = false, data_cancelamento = v_hoje, updated_at = now()
  WHERE id = p_cliente_produto_id;

  RETURN v_result || jsonb_build_object('modulos_inativados', v_modulos);
END;
$$;
