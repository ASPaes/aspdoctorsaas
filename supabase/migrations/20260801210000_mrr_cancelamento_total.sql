-- MRR: cancelamento total zera o saldo do cliente
--
-- PROBLEMA
-- Existiam dois mecanismos concorrentes de baixa no cancelamento:
--   (a) inativar cliente_produtos  -> tira do saldo
--   (b) gravar movimento 'churn'   -> tira do saldo de novo
-- Qual atuava dependia de existir contrato_itens ligando contrato->produto.
-- Quando os dois atuavam, o cliente ficava com MRR NEGATIVO
-- (828 clientes em prod, -R$ 269.742,24 somados).
-- E o upsell lançado solto (contrato_id NULL) nunca era baixado:
-- o churn era calculado de contratos.vlr_total_mensal, que não o conhece.
--
-- REGRA (Alexandre, 01/08/2026)
-- Não existe cliente sem contrato com upsell ativo. Cancelou o único
-- contrato -> cancela tudo: produtos, módulos e movimentos recorrentes.
--
-- DESENHO
-- Saldo  = cliente_produtos vigentes + movimentos recorrentes vigentes.
-- Extrato = movimentos_mrr (churn/reactivation), serve ao Net New / bridge.
-- Os dois deixam de se sobrepor: churn e reactivation saem do saldo.
--
-- A baixa do movimento é por `encerrado_em`, NÃO por `status`.
-- Marcar status='inativo' faria o upsell de junho sumir do Net New de junho
-- no dashboard e em get_mrr_bridge. O movimento continua sendo fato do
-- passado; só para de compor o saldo a partir da data de encerramento.
--
-- Cancelamento PARCIAL fica como está: com movimento solto não há como
-- saber de qual contrato ele é. Assunto separado.

-- ---------------------------------------------------------------------------
-- 1. Vigência do movimento recorrente
-- ---------------------------------------------------------------------------

ALTER TABLE public.movimentos_mrr
  ADD COLUMN IF NOT EXISTS encerrado_em date,
  ADD COLUMN IF NOT EXISTS encerrado_por_contrato_id uuid REFERENCES public.contratos(id);

COMMENT ON COLUMN public.movimentos_mrr.encerrado_em IS
  'Data em que o movimento deixou de compor o saldo do cliente. NULL = vigente. '
  'Independente de status: o movimento continua válido como fato do passado '
  '(entra no Net New do mês em que ocorreu), mas não soma no saldo a partir daqui.';

COMMENT ON COLUMN public.movimentos_mrr.encerrado_por_contrato_id IS
  'Contrato cujo cancelamento encerrou este movimento. Reativar esse contrato desfaz a baixa.';

CREATE INDEX IF NOT EXISTS idx_mov_mrr_encerrado_por_contrato
  ON public.movimentos_mrr (encerrado_por_contrato_id)
  WHERE encerrado_por_contrato_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Saldo do cliente numa data
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.fn_mrr_cliente_em(p_tenant uuid, p_cliente uuid, p_data date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT SUM(cp.vlr_mensal) FROM public.cliente_produtos cp
     WHERE cp.cliente_id = p_cliente AND cp.tenant_id = p_tenant
       AND (cp.ativo = true OR cp.data_cancelamento > p_data)
  ), 0)
  + COALESCE((
    SELECT SUM(mv.valor_delta) FROM public.movimentos_mrr mv
     WHERE mv.cliente_id = p_cliente AND mv.tenant_id = p_tenant
       AND mv.tipo IN ('upsell','cross_sell','downsell','reajuste')
       AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
       AND mv.data_movimento <= p_data
       AND (mv.encerrado_em IS NULL OR mv.encerrado_em > p_data)
  ), 0);
$$;

COMMENT ON FUNCTION public.fn_mrr_cliente_em(uuid, uuid, date) IS
  'SALDO de MRR do cliente numa data: produtos vigentes naquela data + movimentos '
  'recorrentes vigentes naquela data. NÃO soma churn/reactivation — esses são o '
  'EXTRATO (fluxo do Net New), e somá-los aqui descontava a baixa duas vezes. '
  'A baixa do saldo é sempre pelo cadastro: cliente_produtos.data_cancelamento e '
  'movimentos_mrr.encerrado_em. '
  'NÃO usar vw_clientes_financeiro.mensalidade para data passada — é a foto de hoje.';

