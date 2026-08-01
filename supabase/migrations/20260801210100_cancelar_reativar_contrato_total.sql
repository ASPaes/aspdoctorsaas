-- cancelar_contrato / reativar_contrato: cancelamento total leva tudo junto
--
-- Depende de 20260801210000_mrr_cancelamento_total.sql (encerrado_em).
--
-- MUDANÇAS
-- 1. Cancelamento TOTAL (nenhum contrato ativo sobrou):
--    - inativa TODOS os cliente_produtos/módulos que sobraram, não só os
--      ligados por contrato_itens. Contrato implícito não tem contrato_itens,
--      e por isso 8 clientes cancelados em prod seguiam com produto ativo.
--    - encerra os movimentos recorrentes (upsell/cross/downsell/reajuste).
--    - churn passa a ser o MRR CHEIO do cliente, não contratos.vlr_total_mensal.
--      Era daí que vinha o upsell de R$ 60 do BECO LANCHES ficar fora do churn.
-- 2. Cancelamento PARCIAL: inalterado. Com movimento solto não dá pra saber de
--    qual contrato ele é — assunto separado.
-- 3. reativar_contrato desfaz a baixa pelo encerrado_por_contrato_id e devolve
--    o MRR pelo mesmo critério com que foi tirado.

BEGIN;

CREATE OR REPLACE FUNCTION public.cancelar_contrato(
  p_contrato_id uuid,
  p_motivo_id bigint DEFAULT NULL::bigint,
  p_observacao text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ct RECORD;
  v_prod RECORD;
  v_afetados jsonb := '[]'::jsonb;
  v_mrr_id uuid;
  v_evt_id uuid;
  v_outros_ativos boolean;
  v_todos_cancelados boolean;
  v_mensalidade_cliente_antes numeric;
  v_mrr_cheio numeric;
  v_churn numeric;
  v_movs_encerrados integer := 0;
BEGIN
  IF NOT is_admin_or_head() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: apenas admin/head';
  END IF;

  SELECT c.id, c.tenant_id, c.cliente_id, c.status, c.vlr_total_mensal
    INTO v_ct
  FROM contratos c WHERE c.id = p_contrato_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  IF v_ct.status = 'cancelado' THEN RAISE EXCEPTION 'Contrato já está cancelado'; END IF;

  SELECT COALESCE(mensalidade, 0) INTO v_mensalidade_cliente_antes
  FROM clientes WHERE id = v_ct.cliente_id;

  -- Saldo cheio ANTES de qualquer mutação: produtos vigentes + recorrentes
  -- vigentes. É o que o cliente valia na véspera do cancelamento.
  v_mrr_cheio := public.fn_mrr_cliente_em(v_ct.tenant_id, v_ct.cliente_id, v_hoje);

  -- skip triggers de sync de valor durante a operação (preserva valores históricos)
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  -- Inativa cliente_produtos e modulos vinculados ao contrato (sem zerar valores)
  FOR v_prod IN
    SELECT DISTINCT ci.cliente_produto_id,
           cp.id as cp_id,
           (SELECT p.nome FROM produtos p WHERE p.id = cp.produto_id) as produto_nome,
           cp.vlr_mensal, cp.vlr_custo
    FROM contrato_itens ci
    JOIN cliente_produtos cp ON cp.id = ci.cliente_produto_id
    WHERE ci.contrato_id = p_contrato_id AND cp.ativo = true
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM contrato_itens ci2
      JOIN contratos ct2 ON ct2.id = ci2.contrato_id
      WHERE ci2.cliente_produto_id = v_prod.cp_id
        AND ct2.id != p_contrato_id AND ct2.status = 'ativo'
    ) INTO v_outros_ativos;

    IF NOT v_outros_ativos THEN
      UPDATE cliente_produto_modulos SET ativo = false, data_inativacao = v_hoje
      WHERE cliente_produto_id = v_prod.cp_id AND ativo = true;
      UPDATE cliente_produtos SET ativo = false, data_cancelamento = v_hoje
      WHERE id = v_prod.cp_id;
      v_afetados := v_afetados || jsonb_build_object(
        'cliente_produto_id', v_prod.cp_id, 'nome', v_prod.produto_nome,
        'vlr_mensal', v_prod.vlr_mensal, 'acao', 'inativado');
    ELSE
      v_afetados := v_afetados || jsonb_build_object(
        'cliente_produto_id', v_prod.cp_id, 'nome', v_prod.produto_nome,
        'vlr_mensal', v_prod.vlr_mensal, 'acao', 'protegido_outro_contrato');
    END IF;
  END LOOP;

  UPDATE contratos SET status = 'cancelado', cancelado_em = v_hoje, motivo_cancelamento = p_observacao
  WHERE id = p_contrato_id;

  SELECT NOT EXISTS (
    SELECT 1 FROM contratos WHERE cliente_id = v_ct.cliente_id AND status = 'ativo'
  ) INTO v_todos_cancelados;

  IF v_todos_cancelados THEN
    -- Cancelou o último contrato: não sobra saldo em lugar nenhum.
    -- Varre o que os contrato_itens não alcançaram (contrato implícito).
    FOR v_prod IN
      SELECT cp.id as cp_id,
             (SELECT p.nome FROM produtos p WHERE p.id = cp.produto_id) as produto_nome,
             cp.vlr_mensal, cp.vlr_custo
      FROM cliente_produtos cp
      WHERE cp.cliente_id = v_ct.cliente_id AND cp.ativo = true
    LOOP
      UPDATE cliente_produto_modulos SET ativo = false, data_inativacao = v_hoje
      WHERE cliente_produto_id = v_prod.cp_id AND ativo = true;
      UPDATE cliente_produtos SET ativo = false, data_cancelamento = v_hoje
      WHERE id = v_prod.cp_id;
      v_afetados := v_afetados || jsonb_build_object(
        'cliente_produto_id', v_prod.cp_id, 'nome', v_prod.produto_nome,
        'vlr_mensal', v_prod.vlr_mensal, 'acao', 'inativado');
    END LOOP;

    -- Encerra os movimentos recorrentes soltos (upsell lançado sem contrato).
    -- encerrado_em, não status: o movimento continua contando no Net New do
    -- mês em que ocorreu; só para de compor o saldo daqui pra frente.
    UPDATE movimentos_mrr
       SET encerrado_em = v_hoje,
           encerrado_por_contrato_id = p_contrato_id
     WHERE cliente_id = v_ct.cliente_id
       AND tenant_id = v_ct.tenant_id
       AND tipo IN ('upsell','cross_sell','downsell','reajuste')
       AND status = 'ativo'
       AND estornado_por IS NULL AND estorno_de IS NULL
       AND encerrado_em IS NULL;
    GET DIAGNOSTICS v_movs_encerrados = ROW_COUNT;
  END IF;

  PERFORM set_config('doctorsaas.skip_valor_sync', '', true);

  IF v_todos_cancelados THEN
    -- Caso TOTAL: apenas grava metadados de cancelamento. NÃO mexer em mensalidade/custo_operacao.
    -- A flag clientes.cancelado=true é setada pelo trigger fn_derive_cliente_cancelado.
    UPDATE clientes
       SET data_cancelamento = v_hoje,
           motivo_cancelamento_id = p_motivo_id,
           observacao_cancelamento = p_observacao
     WHERE id = v_ct.cliente_id;
  ELSE
    -- Caso PARCIAL: ainda existe contrato ativo. Recalcula mensalidade/custo
    -- pra refletir produtos ainda ativos (premissa 2 aprovada pelo Alexandre).
    UPDATE clientes
       SET mensalidade = COALESCE((
             SELECT SUM(cp.vlr_mensal) FROM cliente_produtos cp
              WHERE cp.cliente_id = v_ct.cliente_id AND cp.ativo = true
           ), 0),
           custo_operacao = COALESCE((
             SELECT SUM(cp.vlr_custo) FROM cliente_produtos cp
              WHERE cp.cliente_id = v_ct.cliente_id AND cp.ativo = true
           ), 0)
     WHERE id = v_ct.cliente_id;
  END IF;

  -- Movimento MRR (churn).
  -- TOTAL  -> o cliente inteiro saiu: churn é o saldo cheio (base + recorrentes).
  -- PARCIAL -> como antes: o valor do contrato cancelado.
  v_churn := ROUND(
    CASE WHEN v_todos_cancelados THEN COALESCE(v_mrr_cheio, 0)
         ELSE COALESCE(v_ct.vlr_total_mensal, 0) END, 2);

  INSERT INTO movimentos_mrr (
    tenant_id, cliente_id, contrato_id, tipo, data_movimento,
    valor_delta, custo_delta, descricao, status
  ) VALUES (
    v_ct.tenant_id, v_ct.cliente_id, p_contrato_id, 'churn', v_hoje,
    -1 * v_churn, 0,
    'Cancelamento contrato' || CASE WHEN p_observacao IS NOT NULL THEN ': ' || p_observacao ELSE '' END,
    'ativo'
  ) RETURNING id INTO v_mrr_id;

  -- Evento (snapshot histórico)
  INSERT INTO contrato_eventos (
    tenant_id, contrato_id, cliente_id, acao, data_acao,
    motivo_cancelamento_id, observacao, usuario_id,
    mensalidade_contrato_snapshot, mensalidade_cliente_snapshot,
    produtos_afetados, movimento_mrr_id
  ) VALUES (
    v_ct.tenant_id, p_contrato_id, v_ct.cliente_id, 'cancelamento', v_hoje,
    p_motivo_id, p_observacao, v_uid,
    COALESCE(v_ct.vlr_total_mensal, 0), v_mensalidade_cliente_antes,
    v_afetados, v_mrr_id
  ) RETURNING id INTO v_evt_id;

  RETURN jsonb_build_object(
    'success', true, 'evento_id', v_evt_id, 'contrato_id', p_contrato_id,
    'cliente_cancelado', v_todos_cancelados,
    'mrr_churn', v_churn,
    'movimentos_encerrados', v_movs_encerrados,
    'produtos_afetados', v_afetados
  );
END;
$function$;


CREATE OR REPLACE FUNCTION public.reativar_contrato(
  p_contrato_id uuid,
  p_observacao text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_ct RECORD;
  v_ultimo_cancel RECORD;
  v_item jsonb;
  v_cp_id uuid;
  v_reativados jsonb := '[]'::jsonb;
  v_mrr_id uuid;
  v_evt_id uuid;
  v_era_cancelado boolean;
  v_prod RECORD;
  v_tem_ativo boolean;
  v_mrr_antes numeric;
  v_mrr_depois numeric;
  v_reactivation numeric;
  v_movs_reabertos integer := 0;
BEGIN
  IF NOT is_admin_or_head() AND NOT is_super_admin() THEN
    RAISE EXCEPTION 'forbidden: apenas admin/head';
  END IF;

  SELECT c.id, c.tenant_id, c.cliente_id, c.status, c.vlr_total_mensal
    INTO v_ct
  FROM contratos c WHERE c.id = p_contrato_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato não encontrado'; END IF;
  IF v_ct.status != 'cancelado' THEN RAISE EXCEPTION 'Contrato não está cancelado'; END IF;

  SELECT cancelado INTO v_era_cancelado FROM clientes WHERE id = v_ct.cliente_id;

  -- Saldo antes de restaurar qualquer coisa
  v_mrr_antes := public.fn_mrr_cliente_em(v_ct.tenant_id, v_ct.cliente_id, v_hoje);

  -- Buscar último evento de cancelamento
  SELECT produtos_afetados INTO v_ultimo_cancel
  FROM contrato_eventos
  WHERE contrato_id = p_contrato_id AND acao = 'cancelamento'
  ORDER BY created_at DESC LIMIT 1;

  UPDATE contratos SET status = 'ativo', cancelado_em = NULL, motivo_cancelamento = NULL
  WHERE id = p_contrato_id;

  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  IF v_ultimo_cancel.produtos_afetados IS NOT NULL
     AND jsonb_array_length(v_ultimo_cancel.produtos_afetados) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_ultimo_cancel.produtos_afetados)
    LOOP
      IF v_item->>'acao' = 'inativado' THEN
        v_cp_id := (v_item->>'cliente_produto_id')::uuid;
        UPDATE cliente_produtos SET ativo = true, data_cancelamento = NULL
        WHERE id = v_cp_id AND ativo = false;
        UPDATE cliente_produto_modulos SET ativo = true, data_inativacao = NULL
        WHERE cliente_produto_id = v_cp_id AND ativo = false;
        v_reativados := v_reativados || jsonb_build_object(
          'cliente_produto_id', v_cp_id, 'nome', v_item->>'nome',
          'vlr_mensal', v_item->>'vlr_mensal', 'acao', 'reativado');
      END IF;
    END LOOP;
  ELSE
    FOR v_prod IN
      SELECT DISTINCT ci.cliente_produto_id,
             cp.id as cp_id,
             (SELECT p.nome FROM produtos p WHERE p.id = cp.produto_id) as produto_nome,
             cp.vlr_mensal
      FROM contrato_itens ci
      JOIN cliente_produtos cp ON cp.id = ci.cliente_produto_id
      WHERE ci.contrato_id = p_contrato_id
        AND cp.ativo = false
    LOOP
      UPDATE cliente_produtos SET ativo = true, data_cancelamento = NULL
      WHERE id = v_prod.cp_id;
      UPDATE cliente_produto_modulos SET ativo = true, data_inativacao = NULL
      WHERE cliente_produto_id = v_prod.cp_id AND ativo = false;
      v_reativados := v_reativados || jsonb_build_object(
        'cliente_produto_id', v_prod.cp_id, 'nome', v_prod.produto_nome,
        'vlr_mensal', v_prod.vlr_mensal, 'acao', 'reativado');
    END LOOP;
  END IF;

  -- Desfaz a baixa dos movimentos recorrentes que ESTE contrato encerrou.
  UPDATE movimentos_mrr
     SET encerrado_em = NULL,
         encerrado_por_contrato_id = NULL
   WHERE cliente_id = v_ct.cliente_id
     AND tenant_id = v_ct.tenant_id
     AND encerrado_por_contrato_id = p_contrato_id;
  GET DIAGNOSTICS v_movs_reabertos = ROW_COUNT;

  PERFORM set_config('doctorsaas.skip_valor_sync', '', true);

  -- Recalcular mensalidade
  UPDATE clientes SET mensalidade = COALESCE((
    SELECT SUM(cp.vlr_mensal) FROM cliente_produtos cp
    WHERE cp.cliente_id = v_ct.cliente_id AND cp.ativo = true
  ), 0) WHERE id = v_ct.cliente_id;

  -- HARDENED: derivar cancelado de contratos ativos (não depende de v_era_cancelado)
  v_tem_ativo := EXISTS(SELECT 1 FROM contratos WHERE cliente_id = v_ct.cliente_id AND status = 'ativo');

  UPDATE clientes SET
    cancelado = NOT v_tem_ativo,
    data_cancelamento = CASE WHEN v_tem_ativo THEN NULL ELSE data_cancelamento END,
    data_reativacao = CASE WHEN v_era_cancelado THEN v_hoje ELSE data_reativacao END,
    reativado_por_user_id = CASE WHEN v_era_cancelado THEN v_uid ELSE reativado_por_user_id END,
    observacao_reativacao = CASE WHEN v_era_cancelado THEN p_observacao ELSE observacao_reativacao END
  WHERE id = v_ct.cliente_id;

  -- Movimento MRR: devolve exatamente o que voltou ao saldo. Simétrico ao churn.
  v_mrr_depois := public.fn_mrr_cliente_em(v_ct.tenant_id, v_ct.cliente_id, v_hoje);
  v_reactivation := ROUND(GREATEST(COALESCE(v_mrr_depois, 0) - COALESCE(v_mrr_antes, 0), 0), 2);

  INSERT INTO movimentos_mrr (
    tenant_id, cliente_id, contrato_id, tipo, data_movimento,
    valor_delta, custo_delta, descricao, status
  ) VALUES (
    v_ct.tenant_id, v_ct.cliente_id, p_contrato_id, 'reactivation', v_hoje,
    v_reactivation, 0,
    'Reativação contrato' || CASE WHEN p_observacao IS NOT NULL THEN ': ' || p_observacao ELSE '' END,
    'ativo'
  ) RETURNING id INTO v_mrr_id;

  -- Evento
  INSERT INTO contrato_eventos (
    tenant_id, contrato_id, cliente_id, acao, data_acao,
    observacao, usuario_id,
    mensalidade_contrato_snapshot, mensalidade_cliente_snapshot,
    produtos_afetados, movimento_mrr_id
  ) VALUES (
    v_ct.tenant_id, p_contrato_id, v_ct.cliente_id, 'reativacao', v_hoje,
    p_observacao, v_uid,
    COALESCE(v_ct.vlr_total_mensal, 0),
    (SELECT mensalidade FROM clientes WHERE id = v_ct.cliente_id),
    v_reativados, v_mrr_id
  ) RETURNING id INTO v_evt_id;

  RETURN jsonb_build_object(
    'success', true, 'evento_id', v_evt_id, 'contrato_id', p_contrato_id,
    'cliente_reativado', COALESCE(v_era_cancelado, false),
    'mrr_reactivation', v_reactivation,
    'movimentos_reabertos', v_movs_reabertos,
    'produtos_reativados', v_reativados
  );
END;
$function$;

COMMIT;
