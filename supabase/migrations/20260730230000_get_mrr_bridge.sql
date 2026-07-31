-- get_mrr_bridge: a ponte do mes, que FECHA por construcao
--
-- PROBLEMA
-- O painel media o saldo com uma regua e o movimento com outra:
--   MRR ATUAL      -> get_mrr_monthly_snapshots (estoque)
--   Net New MRR    -> useDashboardData (eventos, regras proprias)
-- Resultado: MRR(mes anterior) + Net New != MRR(mes). Sobrava R$ 8k a R$ 21k por mes.
--
-- Duas causas, ambas no lado do Net New:
--   1. `newMrr` somava `vw_clientes_financeiro.mensalidade`, que e o valor dos produtos
--      ativos HOJE. Cliente que entrou em abril e derrubou um produto em junho encolhia
--      retroativamente no "new" de abril. (abril/26 Digi Office unid 6: R$ 9.204 no card,
--      R$ 12.016 de verdade.)
--   2. Churn parcial -- cliente que FICA na base e cancela um produto -- nao entrava em
--      lugar nenhum. O dinheiro sumia do MRR sem aparecer no churn. (abril: R$ 1.503.)
--
-- SOLUCAO
-- Uma funcao so, que calcula estoque e movimento com a MESMA regua: o valor do cliente
-- numa data e sempre `base temporal de produtos + deltas do ledger ate a data`, igual a
-- get_mrr_monthly_snapshots. Dai:
--
--   mrr_fim = mrr_inicio + novo + upsell + cross_sell + reativacao + reajuste
--                        + downsell + churn        (downsell e churn ja vem negativos)
--
-- Nao e ajuste nem arredondamento: fecha em zero por definicao, porque cada componente
-- e uma particao da mesma diferenca.
--   novo       = quem entrou no periodo (data_venda_efetiva depois do corte inicial)
--   reativacao = quem voltou a base + movimentos `reactivation` de quem ficou
--   churn      = quem saiu da base + movimentos `churn` de quem ficou (churn parcial)
--   upsell/cross_sell/reajuste/downsell = movimentos do periodo de quem ficou
--
-- VALIDADO (banco local com dados de producao de 30/07/2026, Digi Office unid 6):
--   mes     mrr_inicio    novo     upsell  reativ  reajuste  downsell     churn    mrr_fim
--   abr/26  390.042,35  12.016,13    0,00    0,00      0,00      0,00 -14.050,70 388.007,78
--   mai/26  388.007,78  10.794,92 1.536,45 1.732,30 1.908,79 -4.405,76 -22.078,16 377.496,32
--   jun/26  377.496,32  12.845,53 5.052,21   381,74 3.091,03 -2.363,06 -14.841,25 381.662,52
--   jul/26  381.662,52   8.816,18 5.179,75   459,13 2.608,20 -5.755,84  -8.640,60 384.329,34
--   Diferenca (mrr_inicio + componentes - mrr_fim): R$ 0,00 nos quatro meses.
--   mrr_fim de cada mes = mrr_inicio do seguinte.
--
-- Depende de 20260730220000_mrr_snapshot_base_temporal.sql (mesma base temporal).

CREATE OR REPLACE FUNCTION public.get_mrr_bridge(
  p_tenant_id uuid,
  p_inicio date,
  p_fim date,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_fornecedor_ids bigint[] DEFAULT NULL::bigint[]
)
RETURNS TABLE(
  mrr_inicio numeric,
  novo numeric,
  upsell numeric,
  cross_sell numeric,
  reativacao numeric,
  reajuste numeric,
  downsell numeric,
  churn numeric,
  net_new numeric,
  mrr_fim numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

  v_d1       := p_inicio - 1;               -- ultimo dia antes do periodo
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
      -- valor do cliente no corte inicial
      (SELECT COALESCE(SUM(cp.vlr_mensal), 0) FROM public.cliente_produtos cp
        WHERE cp.cliente_id = e.id AND cp.tenant_id = p_tenant_id
          AND (cp.ativo = true OR cp.data_cancelamento > v_d1))
      + COALESCE((SELECT SUM(mv.valor_delta) FROM public.movimentos_mrr mv
          WHERE mv.cliente_id = e.id AND mv.tenant_id = p_tenant_id
            AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
            AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
            AND mv.data_movimento <= v_d1), 0) AS v1,
      -- valor do cliente no corte final
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
  -- movimentos DO PERIODO de quem estava na base nas duas pontas
  mvf AS (
    SELECT mv.tipo::text AS tipo, SUM(mv.valor_delta) AS s
    FROM val x
    JOIN public.movimentos_mrr mv
      ON mv.cliente_id = x.id AND mv.tenant_id = p_tenant_id
     AND mv.data_movimento > v_d1 AND mv.data_movimento <= p_fim
     AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
    WHERE x.in1 AND x.in2
    GROUP BY 1
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
      COALESCE((SELECT s FROM mvf WHERE tipo='upsell'), 0)       AS upsell,
      COALESCE((SELECT s FROM mvf WHERE tipo='cross_sell'), 0)   AS cross_sell,
      COALESCE((SELECT s FROM mvf WHERE tipo='reajuste'), 0)     AS reajuste,
      COALESCE((SELECT s FROM mvf WHERE tipo='downsell'), 0)     AS downsell,
      COALESCE((SELECT s FROM mvf WHERE tipo='churn'), 0)        AS churn_parcial,
      COALESCE((SELECT s FROM mvf WHERE tipo='reactivation'), 0) AS react_parcial
  )
  SELECT
    ROUND(ag.mrr_inicio, 2),
    ROUND(ag.novo, 2),
    ROUND(m.upsell, 2),
    ROUND(m.cross_sell, 2),
    ROUND(ag.reentrantes + m.react_parcial, 2)                       AS reativacao,
    ROUND(m.reajuste, 2),
    ROUND(m.downsell, 2),                                            -- ja negativo
    ROUND(ag.saidas + m.churn_parcial, 2)                            AS churn,  -- ja negativo
    ROUND(ag.novo + m.upsell + m.cross_sell + ag.reentrantes + m.react_parcial
          + m.reajuste + m.downsell + ag.saidas + m.churn_parcial, 2) AS net_new,
    ROUND(ag.mrr_fim, 2)
  FROM ag CROSS JOIN m;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mrr_bridge(uuid, date, date, bigint, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mrr_bridge(uuid, date, date, bigint, bigint[]) TO authenticated, service_role;
