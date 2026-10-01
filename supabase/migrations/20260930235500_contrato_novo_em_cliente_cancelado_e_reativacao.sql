-- Contrato novo em cliente cancelado = reativacao (30/09/2026).
--
-- O BURACO: so o botao "Reativar contrato" (reativar_contrato) gravava a
-- reativacao. Quando o cliente cancelado volta por contrato NOVO (Calculadora
-- ou tela), nada era gravado. O cliente sumia dos dois cards: nao entra em
-- Novos Clientes (a 1a venda da ficha e antiga) nem em Reativacoes (o card le
-- contrato_eventos acao='reativacao'). E o MRR dele no Dashboard ficava errado:
-- a regua do frontend e a get_mrr_bridge somam o churn antigo do ledger, que
-- so e compensado por um movimento de reativacao. Caso real: HORIZONTE BIER,
-- R$ 484,80 de produto aparecendo como R$ 6,60.
--
-- A REGRA (Alexandre, 30/09/2026): conta como reativacao quando o cliente nao
-- tem outro contrato ativo e o ultimo cancelamento foi ha MAIS de 7 dias da
-- venda do contrato novo. Cancelar e refazer na mesma semana e correcao de
-- cadastro (caso CAFE VARANDA: cancelado 20/08, refeito 20/08), nao reativacao.
-- Contrato com mensalidade 0 (evento unico) nao conta.
--
-- O QUE GRAVA, igual ao reativar_contrato:
--   * movimentos_mrr 'reactivation' no valor do churn ainda em aberto, que
--     zera o churn no ledger (so quando ha churn a compensar);
--   * contrato_eventos 'reativacao' com a mensalidade do contrato novo, que e
--     o que o card de Reativacoes soma;
--   * clientes.data_reativacao.
-- Nada vai para o Omie: trg_movimento_mrr_enfileirar_omie ignora 'reactivation'.
--
-- POR QUE GATILHO DE CONSTRAINT ADIADO: create_cliente_produto_with_contract e a
-- tela inserem o contrato e so depois os itens e o valor. Adiado para o COMMIT,
-- o gatilho le o contrato ja completo. So INSERT: reativar_contrato faz UPDATE
-- de status e ja grava a propria reativacao.
CREATE OR REPLACE FUNCTION public.fn_reativacao_por_contrato_novo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ct        record;
  v_data      date;
  v_ult_canc  date;
  v_churn     numeric;
  v_mov_id    uuid;
BEGIN
  -- Relido no commit: o valor e o status finais, nao os do INSERT.
  SELECT id, tenant_id, cliente_id, status, data_venda, data_inicio, vlr_total_mensal
    INTO v_ct
    FROM contratos WHERE id = NEW.id;

  IF NOT FOUND OR v_ct.status <> 'ativo' OR coalesce(v_ct.vlr_total_mensal, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  -- Outro contrato ativo = cliente nao estava cancelado.
  IF EXISTS (SELECT 1 FROM contratos c
              WHERE c.cliente_id = v_ct.cliente_id AND c.id <> v_ct.id AND c.status = 'ativo') THEN
    RETURN NULL;
  END IF;

  -- Ja reativado por este contrato (reprocessamento).
  IF EXISTS (SELECT 1 FROM contrato_eventos e
              WHERE e.contrato_id = v_ct.id AND e.acao = 'reativacao') THEN
    RETURN NULL;
  END IF;

  v_data := coalesce(v_ct.data_venda, v_ct.data_inicio,
                     (now() AT TIME ZONE 'America/Sao_Paulo')::date);

  SELECT max(c.cancelado_em) INTO v_ult_canc
    FROM contratos c
   WHERE c.cliente_id = v_ct.cliente_id AND c.id <> v_ct.id AND c.status = 'cancelado';

  IF v_ult_canc IS NULL OR v_ult_canc > v_data - 7 THEN
    RETURN NULL;
  END IF;

  -- Churn ainda nao compensado por reativacao anterior.
  SELECT -coalesce(sum(m.valor_delta), 0) INTO v_churn
    FROM movimentos_mrr m
   WHERE m.cliente_id = v_ct.cliente_id AND m.tenant_id = v_ct.tenant_id
     AND m.tipo IN ('churn', 'reactivation')
     AND m.status = 'ativo' AND m.estornado_por IS NULL AND m.estorno_de IS NULL;

  IF v_churn > 0 THEN
    INSERT INTO movimentos_mrr (
      tenant_id, cliente_id, contrato_id, tipo, data_movimento,
      valor_delta, custo_delta, descricao, status
    ) VALUES (
      v_ct.tenant_id, v_ct.cliente_id, v_ct.id, 'reactivation', v_data,
      round(v_churn, 2), 0, 'Reativação por contrato novo', 'ativo'
    ) RETURNING id INTO v_mov_id;
  END IF;

  INSERT INTO contrato_eventos (
    tenant_id, contrato_id, cliente_id, acao, data_acao,
    observacao, usuario_id,
    mensalidade_contrato_snapshot, mensalidade_cliente_snapshot,
    produtos_afetados, movimento_mrr_id
  ) VALUES (
    v_ct.tenant_id, v_ct.id, v_ct.cliente_id, 'reativacao', v_data,
    'Reativação por contrato novo (cliente cancelado desde ' || to_char(v_ult_canc, 'DD/MM/YYYY') || ')',
    auth.uid(),
    v_ct.vlr_total_mensal,
    public.fn_mrr_cliente_em(v_ct.tenant_id, v_ct.cliente_id, v_data),
    '[]'::jsonb, v_mov_id
  );

  UPDATE clientes SET data_reativacao = v_data, reativado_por_user_id = auth.uid()
   WHERE id = v_ct.cliente_id;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_reativacao_por_contrato_novo() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_reativacao_por_contrato_novo ON public.contratos;
CREATE CONSTRAINT TRIGGER trg_reativacao_por_contrato_novo
  AFTER INSERT ON public.contratos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'ativo')
  EXECUTE FUNCTION public.fn_reativacao_por_contrato_novo();
