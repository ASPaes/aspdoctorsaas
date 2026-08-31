-- Cancelamento com DATA DE SAÍDA, para o churn cair no mês em que o cliente
-- realmente saiu.
--
-- 19 clientes estão ativos aqui e inativos no Hiper — R$ 4.665,97 de MRR que a
-- base conta como receita viva, alguns desde dezembro. O portal tem a data em
-- 17 deles.
--
-- As duas funções de cancelamento usavam `hoje` fixo para tudo: data_cancelamento,
-- data_inativacao, encerrado_em dos movimentos e o churn. Ganham `p_data`, no
-- FIM e com default NULL — todo chamador de hoje continua idêntico, e sem a data
-- o comportamento é exatamente o de antes.
--
-- As assinaturas de 3 argumentos saem de cena: mantê-las ao lado das novas
-- deixaria uma chamada de 3 argumentos ambígua para o Postgres.
--
-- Corpo copiado de PRODUÇÃO (hash 5492a810…) e alterado em 2 pontos em
-- cancelar_contrato e 3 em cancel_cliente_produto. Nada mais foi tocado.
drop function if exists public.cancelar_contrato(uuid, bigint, text);
drop function if exists public.cancel_cliente_produto(uuid, bigint, text);

CREATE OR REPLACE FUNCTION public.cancelar_contrato(p_contrato_id uuid, p_motivo_id bigint DEFAULT NULL::bigint, p_observacao text DEFAULT NULL::text, p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);  -- p_data = saida retroativa; sem ela, hoje
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
    -- Contrato: o que ESTE contrato valia. Cliente: o que o CLIENTE valia,
    -- movimentos soltos incluídos. Era clientes.mensalidade, que não os conhece
    -- — por isso o histórico do BECO mostrava 219,65 nos dois campos.
    COALESCE(v_ct.vlr_total_mensal, 0), COALESCE(v_mrr_cheio, v_mensalidade_cliente_antes),
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
$function$
;
CREATE OR REPLACE FUNCTION public.cancel_cliente_produto(p_cliente_produto_id uuid, p_motivo_id bigint, p_observacao text DEFAULT NULL::text, p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cp record;
  v_contrato_id uuid;
  v_is_implicit boolean;
  v_itens_count integer;
  v_user_tenant uuid;
  v_result jsonb;
  v_hoje date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);  -- p_data = saida retroativa; sem ela, hoje
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
      PERFORM public.cancelar_contrato(v_contrato_id, p_motivo_id, p_observacao, p_data);
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
$function$
;

-- Recriar função no Postgres devolve o EXECUTE para PUBLIC, e PUBLIC inclui
-- `anon`. As duas estavam em authenticated/service_role e voltam para lá — este
-- projeto já teve RPC de escrita aberta para anon uma vez.
revoke all on function public.cancelar_contrato(uuid, bigint, text, date) from public;
grant execute on function public.cancelar_contrato(uuid, bigint, text, date) to authenticated, service_role;

revoke all on function public.cancel_cliente_produto(uuid, bigint, text, date) from public;
grant execute on function public.cancel_cliente_produto(uuid, bigint, text, date) to authenticated, service_role;
