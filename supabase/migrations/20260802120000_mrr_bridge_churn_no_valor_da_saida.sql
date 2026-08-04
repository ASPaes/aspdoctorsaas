-- get_mrr_bridge: churn passa a valer o que o cliente cobrava QUANDO SAIU.
--
-- Sintoma: a aba Crescimento mostrava churn de R$ 12.481 e a aba Cancelamentos
-- R$ 12.749 para o mesmo período (jul/2026, Digi Office). Diferença: R$ 268,15.
--
-- Causa: o CTE `mvf` só olhava movimentos de quem estava dentro nas DUAS pontas
-- (`WHERE x.in1 AND x.in2`). Quem entrou o mês dentro e saiu no meio tinha TODO o
-- movimento do período ignorado, e o churn era lançado pelo valor do dia anterior ao
-- início (`v1`) — antes do reajuste/upsell que o cliente ainda chegou a pagar.
-- Os 4 casos de jul/2026 (medidos em prod em 02/08):
--   ELOY RODRIGUES ... : 388,90 + 170,00 (upsell)   = 558,90  (ponte marcava 388,90)
--   PONTEIO BAR ...    : 432,19 +  45,03 (reajuste) = 477,22  (ponte marcava 432,19)
--   MASSEO'S ...       : 290,06 +  30,22 (reajuste) = 320,28  (ponte marcava 290,06)
--   CRJJ BOX ...       : 219,74 +  22,90 (reajuste) = 242,64  (ponte marcava 219,74)
-- Soma dos deltas = 268,15, exatamente o buraco. Em todos, `v1 + movimentos` bate
-- centavo a centavo com o `movimentos_mrr.tipo='churn'` que a aba Cancelamentos usa.
--
-- Correção: os movimentos de quem saiu entram nas ENTRADAS (upsell/cross/reajuste/
-- downsell/reativação) como os de qualquer outro, e saem do churn — que passa a ser
-- `-(v1 + movimentos do período)`, ou seja, o valor na data da saída.
--
-- A ponte continua fechando por construção: o que foi somado às entradas é o mesmo
-- valor descontado do churn, então `mrr_inicio + net_new = mrr_fim` não muda.
-- Nenhum outro número da tela muda de total — só a repartição entre as linhas.

CREATE OR REPLACE FUNCTION public.get_mrr_bridge(
  p_tenant_id uuid,
  p_inicio date,
  p_fim date,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_fornecedor_ids bigint[] DEFAULT NULL::bigint[]
)
RETURNS TABLE(
  mrr_inicio numeric, novo numeric, upsell numeric, cross_sell numeric,
  reativacao numeric, reajuste numeric, downsell numeric, churn numeric,
  net_new numeric, mrr_fim numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_d1 date;
  v_is_super boolean;
  v_allowed bigint[];
  v_view bigint[];
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.tenant_id = p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'access denied: tenant scope';
  END IF;

  v_d1       := p_inicio - 1;
  v_is_super := public.is_super_admin();
  v_allowed  := public.user_allowed_unidades();
  v_view     := public.user_view_unidades();

  RETURN QUERY
  WITH esc AS (
    SELECT v.id,
           v.data_venda_efetiva,
           (v.data_venda_efetiva <= v_d1   AND (v.cancelado = false OR v.data_cancelamento > v_d1))   AS in1,
           (v.data_venda_efetiva <= p_fim  AND (v.cancelado = false OR v.data_cancelamento > p_fim))  AS in2
    FROM public.vw_clientes_financeiro v
    WHERE v.tenant_id = p_tenant_id
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND (v_is_super OR v_allowed IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY(v_allowed))
      AND (v_view IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY(v_view))
      AND (
        p_fornecedor_ids IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cp
                    WHERE cp.cliente_id = v.id AND cp.tenant_id = p_tenant_id
                      AND cp.fornecedor_id = ANY(p_fornecedor_ids))
      )
  ),
  val AS (
    SELECT e.id, e.data_venda_efetiva, e.in1, e.in2,
      (SELECT COALESCE(SUM(cp.vlr_mensal), 0) FROM public.cliente_produtos cp
        WHERE cp.cliente_id = e.id AND cp.tenant_id = p_tenant_id
          AND (cp.ativo = true OR cp.data_cancelamento > v_d1))
      + COALESCE((SELECT SUM(mv.valor_delta) FROM public.movimentos_mrr mv
          WHERE mv.cliente_id = e.id AND mv.tenant_id = p_tenant_id
            AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
            AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
            AND mv.data_movimento <= v_d1), 0) AS v1,
      (SELECT COALESCE(SUM(cp.vlr_mensal), 0) FROM public.cliente_produtos cp
        WHERE cp.cliente_id = e.id AND cp.tenant_id = p_tenant_id
          AND (cp.ativo = true OR cp.data_cancelamento > p_fim))
      + COALESCE((SELECT SUM(mv.valor_delta) FROM public.movimentos_mrr mv
          WHERE mv.cliente_id = e.id AND mv.tenant_id = p_tenant_id
            AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
            AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
            AND mv.data_movimento <= p_fim), 0) AS v2
    FROM esc e
    WHERE e.in1 OR e.in2
  ),
  -- Movimentos do período de TODO cliente que existia no início — sobrevivente ou não.
  -- `sobreviveu` separa os dois porque o churn de quem ficou é parcial (soma direto) e o
  -- de quem saiu é o estoque inteiro (vem de `saidas`, e não do ledger).
  mvf AS (
    SELECT (x.in1 AND x.in2) AS sobreviveu, mv.tipo::text AS tipo, SUM(mv.valor_delta) AS s
    FROM val x
    JOIN public.movimentos_mrr mv
      ON mv.cliente_id = x.id AND mv.tenant_id = p_tenant_id
     AND mv.data_movimento > v_d1 AND mv.data_movimento <= p_fim
     AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
     AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
    WHERE x.in1
    GROUP BY 1, 2
  ),
  ag AS (
    SELECT
      SUM(CASE WHEN x.in1 THEN x.v1 ELSE 0 END)                                              AS mrr_inicio,
      SUM(CASE WHEN x.in2 AND NOT x.in1 AND x.data_venda_efetiva >  v_d1 THEN x.v2 ELSE 0 END) AS novo,
      SUM(CASE WHEN x.in2 AND NOT x.in1 AND x.data_venda_efetiva <= v_d1 THEN x.v2 ELSE 0 END) AS reentrantes,
      -SUM(CASE WHEN x.in1 AND NOT x.in2 THEN x.v1 ELSE 0 END)                               AS saidas,
      SUM(CASE WHEN x.in2 THEN x.v2 ELSE 0 END)                                              AS mrr_fim
    FROM val x
  ),
  m AS (
    SELECT
      COALESCE((SELECT SUM(s) FROM mvf WHERE tipo='upsell'), 0)       AS upsell,
      COALESCE((SELECT SUM(s) FROM mvf WHERE tipo='cross_sell'), 0)   AS cross_sell,
      COALESCE((SELECT SUM(s) FROM mvf WHERE tipo='reajuste'), 0)     AS reajuste,
      COALESCE((SELECT SUM(s) FROM mvf WHERE tipo='downsell'), 0)     AS downsell,
      COALESCE((SELECT SUM(s) FROM mvf WHERE tipo='reactivation'), 0) AS react_parcial,
      COALESCE((SELECT SUM(s) FROM mvf WHERE tipo='churn' AND sobreviveu), 0) AS churn_parcial,
      -- Ganho/perda do período de quem saiu. Já entrou nas linhas acima; sai do churn
      -- para não ser contado duas vezes e para a ponte continuar fechando.
      COALESCE((SELECT SUM(s) FROM mvf WHERE NOT sobreviveu AND tipo <> 'churn'), 0) AS mov_de_quem_saiu
  )
  SELECT
    ROUND(ag.mrr_inicio, 2),
    ROUND(ag.novo, 2),
    ROUND(m.upsell, 2),
    ROUND(m.cross_sell, 2),
    ROUND(ag.reentrantes + m.react_parcial, 2)                              AS reativacao,
    ROUND(m.reajuste, 2),
    ROUND(m.downsell, 2),
    ROUND(ag.saidas - m.mov_de_quem_saiu + m.churn_parcial, 2)              AS churn,
    ROUND(ag.novo + m.upsell + m.cross_sell + ag.reentrantes + m.react_parcial
          + m.reajuste + m.downsell
          + (ag.saidas - m.mov_de_quem_saiu + m.churn_parcial), 2)          AS net_new,
    ROUND(ag.mrr_fim, 2)
  FROM ag CROSS JOIN m;
END;
$function$;
