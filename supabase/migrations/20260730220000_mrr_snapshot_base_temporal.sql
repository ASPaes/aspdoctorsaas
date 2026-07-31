-- get_mrr_monthly_snapshots: base temporal de verdade
--
-- PROBLEMA
-- A funcao usava `vw_clientes_financeiro.mensalidade` como base para TODA data de
-- corte passada. Esse campo e SUM(cliente_produtos.vlr_mensal) FILTER (ativo = true):
-- estado de HOJE, sem nocao de tempo.
--
-- Quando um cliente cancela, seus cliente_produtos viram ativo=false e ele passa a
-- valer R$ 0 em TODOS os meses anteriores tambem. A serie historica era reescrita a
-- cada cancelamento -- o erro era zero hoje e crescia quanto mais para tras se olhava.
--
-- Medido em 30/07/2026 (Digi Office, unidade 6):
--   corte     painel        correto      erro
--   31/mar    336.336,98    390.271,35   -53.934
--   30/abr    344.038,07    389.740,08   -45.702
--   31/mai    354.642,69    377.878,06   -23.235
--   30/jun    373.110,47    382.121,65    -9.011
--   31/jul    384.329,34    384.329,34         0
--
-- O painel mostrava +14,3% de crescimento em 4 meses. O numero honesto e -1,5%.
-- Isso contamina tudo que deriva da serie: Growth Rate MoM/QoQ/YoY, ARR Growth,
-- Rule of 40, Growth Persistence, forecast 90d e a media movel de Net New.
--
-- Prova independente do mecanismo: a mesma funcao, com os dados de mar-jun
-- IDENTICOS entre local e producao, devolvia R$ 4.462,71 a menos em producao --
-- exatamente o valor dos 11 cancelamentos que producao tinha em julho e o local nao.
-- Cancelamento de julho baixava marco, abril, maio e junho.
--
-- CORRECAO
-- Base temporal por produto: conta o produto se ele estava ativo NA DATA DE CORTE.
--   SUM(cp.vlr_mensal) WHERE cp.ativo = true OR cp.data_cancelamento > <corte>
-- Viavel porque 100% dos produtos inativos tem data_cancelamento preenchida
-- (833/833 em 12 tenants, conferido em 30/07/2026).
--
-- Os deltas de movimentos_mrr seguem IDENTICOS (inclusive churn e reactivation).
-- Testei excluir churn/reactivation: fica pior. Para todo cliente ativo hoje, churn
-- e reactivation se anulam no ledger (soma liquida R$ 0,00, 0 clientes afetados), e
-- manter os dois modela corretamente a janela entre churn e reativacao.
--
-- VALIDACAO (banco local com dados de producao de 30/07/2026)
--   - Valor de HOJE inalterado nos 12 tenants com dado: diferenca R$ 0,00.
--     O unico numero que ja estava certo continua certo.
--   - Passado corrigido onde houve churn: Digi Office +53.705, ASP +16.434,
--     CONSYSA +4.106, CTM +2.391, DEMO +2.215 (marco/26).
--   - Tenants sem cancelamento no periodo (DELVALE, Athuz, Liberty): inalterados,
--     como esperado -- 0 cancelamentos e 0 produtos inativos.
--   - Mais rapida: 5,7 ms contra 15,9 ms (24 meses, tenant inteiro). A base nova le
--     cliente_produtos por indice; a antiga passava pelo LATERAL da view.
--
-- RESIDUO CONHECIDO (nao e desta funcao)
-- A cadeia MRR(mes anterior) + Net New = MRR(mes) ainda nao fecha exato: sobra
-- +1.308 / +199 / +89 / -187 (abr a jul, Digi Office unid 6). Tudo vem do card de
-- Net New, nao daqui:
--   1. `newMrr` (useDashboardData) usa produtos ativos HOJE -- cliente que entrou e
--      depois derrubou um produto encolhe retroativamente no "new". [+2.812 em abril]
--   2. O Net New ignora churn/reactivation de quem FICA na base (churn parcial).
--   3. O churn do Net New usa o ledger inteiro; o snapshot tira o valor na data de corte.
-- Corrigir isso e trabalho no frontend, separado desta migration.

CREATE OR REPLACE FUNCTION public.get_mrr_monthly_snapshots(
  p_tenant_id uuid,
  p_months_back integer DEFAULT 12,
  p_unidade_base_id bigint DEFAULT NULL::bigint,
  p_fornecedor_id bigint DEFAULT NULL::bigint,
  p_data_referencia date DEFAULT NULL::date,
  p_fornecedor_ids bigint[] DEFAULT NULL::bigint[]
)
RETURNS TABLE(data_corte date, mrr numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ref date;
  v_is_super boolean;
  v_allowed bigint[];
  v_view bigint[];
  v_forn_ids bigint[];
BEGIN
  IF NOT (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.tenant_id = p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'access denied: tenant scope';
  END IF;

  p_months_back := GREATEST(1, LEAST(36, COALESCE(p_months_back, 12)));
  v_ref := COALESCE(p_data_referencia, current_date);

  v_is_super := public.is_super_admin();
  v_allowed  := public.user_allowed_unidades();
  v_view     := public.user_view_unidades();
  v_forn_ids := COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END);

  RETURN QUERY
  WITH meses AS (
    SELECT generate_series(
      date_trunc('month', v_ref - (p_months_back || ' months')::interval),
      date_trunc('month', v_ref),
      interval '1 month'
    )::date AS mes_inicio
  ),
  cortes AS (
    SELECT CASE
        WHEN date_trunc('month', m.mes_inicio) = date_trunc('month', v_ref) THEN v_ref
        ELSE (m.mes_inicio + interval '1 month' - interval '1 day')::date
      END AS d
    FROM meses m
  )
  SELECT c.d AS data_corte,
    COALESCE(SUM(
      -- Base TEMPORAL: o produto conta se estava ativo na data de corte.
      -- Era v.mensalidade (produtos ativos HOJE), que apagava o passado.
      (SELECT COALESCE(SUM(cp.vlr_mensal), 0)
         FROM public.cliente_produtos cp
        WHERE cp.cliente_id = v.id
          AND cp.tenant_id = p_tenant_id
          AND (cp.ativo = true OR cp.data_cancelamento > c.d))
      + COALESCE((
        SELECT SUM(mv.valor_delta) FROM public.movimentos_mrr mv
        WHERE mv.cliente_id = v.id AND mv.tenant_id = p_tenant_id
          AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
          AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
          AND mv.data_movimento <= c.d), 0)
    ), 0)::numeric AS mrr
  FROM cortes c
  LEFT JOIN public.vw_clientes_financeiro v
    ON v.tenant_id = p_tenant_id
   AND v.data_venda_efetiva <= c.d
   AND (v.cancelado = false OR v.data_cancelamento > c.d)
   AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
   AND (v_is_super OR v_allowed IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY(v_allowed))
   AND (v_view IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY(v_view))
   AND (
     v_forn_ids IS NULL
     OR EXISTS (SELECT 1 FROM public.cliente_produtos cp
                 WHERE cp.cliente_id = v.id AND cp.tenant_id = p_tenant_id
                   AND cp.fornecedor_id = ANY(v_forn_ids))
   )
  GROUP BY c.d
  ORDER BY c.d ASC;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_mrr_monthly_snapshots(uuid, integer, bigint, bigint, date, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mrr_monthly_snapshots(uuid, integer, bigint, bigint, date, bigint[]) TO authenticated, service_role;
