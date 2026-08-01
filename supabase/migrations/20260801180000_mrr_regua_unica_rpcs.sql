-- ============================================================================
-- Régua única do MRR — as 10 RPCs de Distribuição, Vendas e Cohort
-- ============================================================================
--
-- Todas usavam `vw_clientes_financeiro.mensalidade` (e `custo_operacao`) com um
-- corte de data. Esses campos são `SUM(...) FILTER (ativo = true)` — o estado de
-- HOJE. Duas consequências:
--
--   1. Estoque de carteira: cliente que cancela um produto passa a valer menos em
--      todos os meses anteriores também. Mesmo bug já corrigido em
--      `get_mrr_monthly_snapshots` (20260730220000) e `get_mrr_bridge` (20260730230000).
--   2. Valor de churn: cliente que cancela TUDO fica com `mensalidade = 0`, então o
--      "MRR perdido" da aba Distribuição aparecia zerado. Medido em 01/08/2026:
--      231 dos 239 cancelamentos de 2026 da Digi Office exibidos como R$ 0
--      (R$ 2.568 exibidos contra R$ 98.696 reais); ASP, CONSYSA, DEMO e CTM com
--      100% dos cancelamentos zerados.
--
-- Nenhuma delas somava `movimentos_mrr` — eram uma terceira régua, diferente tanto
-- do card de MRR quanto da aba Crescimento.
--
-- A definição canônica vira função (`fn_mrr_cliente_em` / `fn_custo_cliente_em`),
-- para não existirem 10 cópias do mesmo predicado. São `LANGUAGE sql STABLE`, então
-- o planner as inlina. `SECURITY INVOKER` de propósito: quem chama continua sujeito
-- ao RLS de `cliente_produtos` e `movimentos_mrr`.
--
-- Assinaturas e RETURNS preservados ao caractere — `CREATE OR REPLACE` substitui,
-- não cria sobrecarga. Conferido contra pg_proc em 01/08/2026.
-- ============================================================================

-- ─── Helpers: a definição canônica, uma vez ────────────────────────────────

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
       AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
       AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
       AND mv.data_movimento <= p_data
  ), 0);
$$;

COMMENT ON FUNCTION public.fn_mrr_cliente_em(uuid, uuid, date) IS
  'MRR de um cliente numa data: produtos ativos NAQUELA data + movimentos do ledger até ela. '
  'Mesma definição de get_mrr_bridge / get_mrr_monthly_snapshots e de src/lib/mrrRuler.ts. '
  'NÃO usar vw_clientes_financeiro.mensalidade para data passada — é FILTER(ativo=true), a foto de hoje.';

CREATE OR REPLACE FUNCTION public.fn_custo_cliente_em(p_tenant uuid, p_cliente uuid, p_data date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE((
    SELECT SUM(cp.vlr_custo) FROM public.cliente_produtos cp
     WHERE cp.cliente_id = p_cliente AND cp.tenant_id = p_tenant
       AND (cp.ativo = true OR cp.data_cancelamento > p_data)
  ), 0);
$$;

COMMENT ON FUNCTION public.fn_custo_cliente_em(uuid, uuid, date) IS
  'COGS do cliente na data, mesma régua de fn_mrr_cliente_em. Não há ledger de custo.';

REVOKE ALL ON FUNCTION public.fn_mrr_cliente_em(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_custo_cliente_em(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_mrr_cliente_em(uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fn_custo_cliente_em(uuid, uuid, date) TO authenticated, service_role;

-- ─── Distribuição: estoque de carteira ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_carteira_breakdown(p_tenant uuid, p_dim text, p_fim date, p_uf text DEFAULT NULL::text, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(label text, qtd bigint, mrr numeric, custo numeric, margem_rs numeric, margem_pct numeric, ticket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      public.fn_mrr_cliente_em(p_tenant, v.id, p_fim)   AS mrr,
      public.fn_custo_cliente_em(p_tenant, v.id, p_fim) AS custo,
      CASE p_dim
        WHEN 'estado'     THEN e.sigla
        WHEN 'cidade'     THEN c.nome
        WHEN 'segmento'   THEN s.nome
        WHEN 'area'       THEN a.nome
        WHEN 'fornecedor' THEN fo.nome
        WHEN 'unidade'    THEN u.nome
      END AS dim_label
    FROM public.vw_clientes_financeiro v
    LEFT JOIN public.estados       e  ON e.id  = v.estado_id
    LEFT JOIN public.cidades       c  ON c.id  = v.cidade_id
    LEFT JOIN public.segmentos     s  ON s.id  = v.segmento_id
    LEFT JOIN public.areas_atuacao a  ON a.id  = v.area_atuacao_id
    LEFT JOIN public.fornecedores  fo ON fo.id = v.fornecedor_id
    LEFT JOIN public.unidades_base u  ON u.id  = v.unidade_base_id
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva <= p_fim
      AND (v.cancelado IS NOT TRUE OR v.data_cancelamento > p_fim)
      AND (p_uf IS NULL OR e.sigla = p_uf)
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  )
  SELECT
    COALESCE(NULLIF(dim_label, ''), '(sem informação)') AS label,
    count(*)::bigint AS qtd,
    round(sum(mrr), 2) AS mrr,
    round(sum(custo), 2) AS custo,
    round(sum(mrr - custo), 2) AS margem_rs,
    CASE WHEN sum(mrr) > 0 THEN round(sum(mrr - custo) / sum(mrr), 4) ELSE 0 END AS margem_pct,
    CASE WHEN count(*) > 0 THEN round(sum(mrr) / count(*), 2) ELSE 0 END AS ticket
  FROM base
  GROUP BY 1
  ORDER BY qtd DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.get_carteira_variacao(p_tenant uuid, p_fim_atual date, p_fim_anterior date, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(uf text, mrr_atual numeric, mrr_anterior numeric, delta_abs numeric, delta_pct numeric, qtd_atual bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH escopo AS (
    SELECT v.id, e.sigla AS uf, v.cancelado, v.data_cancelamento, v.data_venda_efetiva
    FROM public.vw_clientes_financeiro v
    JOIN public.estados e ON e.id = v.estado_id
    WHERE v.tenant_id = p_tenant
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  ),
  a AS (
    SELECT x.uf, sum(public.fn_mrr_cliente_em(p_tenant, x.id, p_fim_atual)) AS mrr, count(*) AS qtd
    FROM escopo x
    WHERE x.data_venda_efetiva <= p_fim_atual
      AND (x.cancelado IS NOT TRUE OR x.data_cancelamento > p_fim_atual)
    GROUP BY x.uf
  ),
  b AS (
    SELECT x.uf, sum(public.fn_mrr_cliente_em(p_tenant, x.id, p_fim_anterior)) AS mrr
    FROM escopo x
    WHERE x.data_venda_efetiva <= p_fim_anterior
      AND (x.cancelado IS NOT TRUE OR x.data_cancelamento > p_fim_anterior)
    GROUP BY x.uf
  )
  SELECT
    COALESCE(a.uf, b.uf) AS uf,
    round(COALESCE(a.mrr, 0), 2) AS mrr_atual,
    round(COALESCE(b.mrr, 0), 2) AS mrr_anterior,
    round(COALESCE(a.mrr, 0) - COALESCE(b.mrr, 0), 2) AS delta_abs,
    CASE WHEN COALESCE(b.mrr, 0) > 0
         THEN round((COALESCE(a.mrr, 0) - COALESCE(b.mrr, 0)) / b.mrr, 4)
         ELSE NULL END AS delta_pct,
    COALESCE(a.qtd, 0)::bigint AS qtd_atual
  FROM a
  FULL OUTER JOIN b ON a.uf = b.uf
  ORDER BY delta_abs DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.get_carteira_serie_uf(p_tenant uuid, p_meses integer DEFAULT 12, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(ym text, uf text, mrr numeric, qtd bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH meses AS (
    SELECT (date_trunc('month', (CURRENT_DATE AT TIME ZONE 'America/Sao_Paulo'))
            - (gs || ' months')::interval)::date AS mes_inicio
    FROM generate_series(0, GREATEST(p_meses, 1) - 1) AS gs
  ),
  fins AS (
    SELECT to_char(mes_inicio, 'YYYY-MM') AS ym,
           (mes_inicio + interval '1 month' - interval '1 day')::date AS fim
    FROM meses
  ),
  cli AS (
    SELECT v.id, e.sigla AS uf, v.data_venda_efetiva, v.cancelado, v.data_cancelamento
    FROM public.vw_clientes_financeiro v
    JOIN public.estados e ON e.id = v.estado_id
    WHERE v.tenant_id = p_tenant
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  ),
  -- Set-based em vez de `fn_mrr_cliente_em` por linha: são 12 cortes × toda a carteira,
  -- e a versão por linha ficou 4x mais lenta (19ms → 84ms na base da Digi Office).
  -- Agregar produto e ledger por (cliente, mês) devolve o mesmo número em ~20ms.
  prod AS (
    SELECT cp.cliente_id, f.ym, SUM(cp.vlr_mensal) AS v
    FROM public.cliente_produtos cp
    JOIN fins f ON (cp.ativo = true OR cp.data_cancelamento > f.fim)
    WHERE cp.tenant_id = p_tenant
    GROUP BY 1, 2
  ),
  mov AS (
    SELECT mv.cliente_id, f.ym, SUM(mv.valor_delta) AS v
    FROM public.movimentos_mrr mv
    JOIN fins f ON mv.data_movimento <= f.fim
    WHERE mv.tenant_id = p_tenant
      AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
      AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
    GROUP BY 1, 2
  )
  SELECT
    f.ym,
    c.uf,
    -- cada mês vale o que valia NAQUELE mês; antes toda a série usava o valor de hoje
    round(sum(COALESCE(p.v, 0) + COALESCE(m.v, 0)), 2) AS mrr,
    count(*)::bigint AS qtd
  FROM fins f
  JOIN cli c
    ON c.data_venda_efetiva <= f.fim
   AND (c.cancelado IS NOT TRUE OR c.data_cancelamento > f.fim)
  LEFT JOIN prod p ON p.cliente_id = c.id AND p.ym = f.ym
  LEFT JOIN mov  m ON m.cliente_id = c.id AND m.ym = f.ym
  GROUP BY f.ym, c.uf
  ORDER BY f.ym, c.uf;
$function$;

CREATE OR REPLACE FUNCTION public.get_carteira_clientes_cidade(p_tenant uuid, p_uf text, p_cidade text, p_fim date, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(cliente text, segmento text, mrr numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(NULLIF(v.nome_fantasia, ''), v.razao_social, '(sem nome)') AS cliente,
    COALESCE(s.nome, '(sem segmento)') AS segmento,
    round(public.fn_mrr_cliente_em(p_tenant, v.id, p_fim), 2) AS mrr
  FROM public.vw_clientes_financeiro v
  JOIN public.estados   e ON e.id = v.estado_id
  JOIN public.cidades   c ON c.id = v.cidade_id
  LEFT JOIN public.segmentos s ON s.id = v.segmento_id
  WHERE v.tenant_id = p_tenant
    AND e.sigla = p_uf
    AND c.nome = p_cidade
    AND v.data_venda_efetiva <= p_fim
    AND (v.cancelado IS NOT TRUE OR v.data_cancelamento > p_fim)
    AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
    AND (
      COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
      OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
    )
  ORDER BY 3 DESC NULLS LAST;
$function$;

-- ─── Distribuição: valor perdido no churn ──────────────────────────────────
-- O cliente vale o que valia na VÉSPERA do cancelamento. Usar o valor de hoje
-- devolvia R$ 0 para quem cancelou tudo — que é a maioria.

CREATE OR REPLACE FUNCTION public.get_carteira_churn(p_tenant uuid, p_nivel text, p_ini date, p_fim date, p_uf text DEFAULT NULL::text, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(label text, base bigint, cancelados bigint, churn_pct numeric, mrr_perdido numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH dim AS (
    SELECT v.id, v.cancelado, v.data_cancelamento, v.data_venda_efetiva,
           CASE WHEN p_nivel = 'cidade' THEN c.nome ELSE e.sigla END AS lbl
    FROM public.vw_clientes_financeiro v
    LEFT JOIN public.estados e ON e.id = v.estado_id
    LEFT JOIN public.cidades c ON c.id = v.cidade_id
    WHERE v.tenant_id = p_tenant
      AND (p_uf IS NULL OR e.sigla = p_uf)
      AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
      )
  ),
  base AS (
    SELECT lbl, count(*) AS n
    FROM dim
    WHERE data_venda_efetiva < p_ini
      AND (cancelado IS NOT TRUE OR data_cancelamento >= p_ini)
    GROUP BY lbl
  ),
  canc AS (
    SELECT lbl, count(*) AS n,
           sum(public.fn_mrr_cliente_em(p_tenant, id, data_cancelamento - 1)) AS mrr
    FROM dim
    WHERE cancelado IS TRUE
      AND data_cancelamento BETWEEN p_ini AND p_fim
    GROUP BY lbl
  )
  SELECT
    COALESCE(NULLIF(COALESCE(b.lbl, k.lbl), ''), '(sem informação)') AS label,
    COALESCE(b.n, 0)::bigint AS base,
    COALESCE(k.n, 0)::bigint AS cancelados,
    CASE WHEN COALESCE(b.n, 0) > 0 THEN round(COALESCE(k.n, 0)::numeric / b.n, 4) ELSE 0 END AS churn_pct,
    round(COALESCE(k.mrr, 0), 2) AS mrr_perdido
  FROM base b
  FULL OUTER JOIN canc k ON k.lbl = b.lbl
  ORDER BY churn_pct DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.get_churn_detalhe_uf(p_tenant uuid, p_uf text, p_ini date, p_fim date, p_fornecedor bigint DEFAULT NULL::bigint, p_unidade bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(cliente text, segmento text, cidade text, mrr_perdido numeric, data_cancelamento date, observacao text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(NULLIF(v.nome_fantasia, ''), v.razao_social, '(sem nome)') AS cliente,
    COALESCE(s.nome, '(sem segmento)') AS segmento,
    COALESCE(c.nome, '') AS cidade,
    round(public.fn_mrr_cliente_em(p_tenant, v.id, v.data_cancelamento - 1), 2) AS mrr_perdido,
    v.data_cancelamento,
    v.observacao_cancelamento AS observacao
  FROM public.vw_clientes_financeiro v
  LEFT JOIN public.estados   e ON e.id = v.estado_id
  LEFT JOIN public.segmentos s ON s.id = v.segmento_id
  LEFT JOIN public.cidades   c ON c.id = v.cidade_id
  WHERE v.tenant_id = p_tenant
    AND e.sigla = p_uf
    AND v.cancelado IS TRUE
    AND v.data_cancelamento >= p_ini
    AND v.data_cancelamento <= p_fim
    AND (p_unidade IS NULL OR v.unidade_base_id = p_unidade)
    AND (
      COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor IS NOT NULL THEN ARRAY[p_fornecedor] ELSE NULL END) IS NULL
      OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = p_tenant AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor])))
    )
  ORDER BY 4 DESC NULLS LAST;
$function$;

-- ─── Vendas ────────────────────────────────────────────────────────────────
-- Venda nova vale o contratado, não o que sobrou depois de o cliente derrubar
-- produto meses adiante. Corte = fim do período consultado (mesma escolha do
-- `novo` de get_mrr_bridge e do newMrr do frontend).

CREATE OR REPLACE FUNCTION public.get_vendas_breakdown(p_tenant uuid, p_ini date, p_fim date, p_dim text, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(label text, qtd bigint, new_mrr numeric, custo numeric, margem_rs numeric, margem_pct numeric, ticket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      public.fn_mrr_cliente_em(p_tenant, v.id, p_fim)   AS mrr,
      public.fn_custo_cliente_em(p_tenant, v.id, p_fim) AS custo,
      CASE p_dim
        WHEN 'vendedor'     THEN f.nome
        WHEN 'canal'        THEN o.nome
        WHEN 'fornecedor'   THEN fo.nome
        WHEN 'segmento'     THEN s.nome
        WHEN 'area'         THEN a.nome
        WHEN 'uf'           THEN e.sigla
        WHEN 'cidade'       THEN c.nome
        WHEN 'unidade'      THEN u.nome
        WHEN 'faixa_ticket' THEN
          CASE
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 200  THEN 'Até R$ 200'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 500  THEN 'R$ 200–500'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 1000 THEN 'R$ 500–1k'
            ELSE 'Acima de R$ 1k'
          END
        WHEN 'faixa_ticket_det' THEN
          CASE
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 100  THEN 'Até R$ 100'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 200  THEN 'R$ 100–200'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 300  THEN 'R$ 200–300'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 500  THEN 'R$ 300–500'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 1000 THEN 'R$ 500–1k'
            WHEN public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) < 2000 THEN 'R$ 1k–2k'
            ELSE 'Acima de R$ 2k'
          END
      END AS dim_label
    FROM public.vw_clientes_financeiro v
    LEFT JOIN public.funcionarios  f  ON f.id  = v.funcionario_id
    LEFT JOIN public.origens_venda o  ON o.id  = v.origem_venda_id
    LEFT JOIN public.fornecedores  fo ON fo.id = v.fornecedor_id
    LEFT JOIN public.segmentos     s  ON s.id  = v.segmento_id
    LEFT JOIN public.areas_atuacao a  ON a.id  = v.area_atuacao_id
    LEFT JOIN public.estados       e  ON e.id  = v.estado_id
    LEFT JOIN public.cidades       c  ON c.id  = v.cidade_id
    LEFT JOIN public.unidades_base u  ON u.id  = v.unidade_base_id
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva BETWEEN p_ini AND p_fim
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cpf WHERE cpf.cliente_id = v.id AND cpf.tenant_id = p_tenant AND cpf.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
  )
  SELECT
    COALESCE(NULLIF(dim_label, ''), '(sem informação)') AS label,
    count(*)::bigint AS qtd,
    round(sum(mrr), 2) AS new_mrr,
    round(sum(custo), 2) AS custo,
    round(sum(mrr - custo), 2) AS margem_rs,
    CASE WHEN sum(mrr) > 0 THEN round(sum(mrr - custo) / sum(mrr), 4) ELSE 0 END AS margem_pct,
    CASE WHEN count(*) > 0 THEN round(sum(mrr) / count(*), 2) ELSE 0 END AS ticket
  FROM base
  GROUP BY 1
  ORDER BY new_mrr DESC NULLS LAST;
$function$;

CREATE OR REPLACE FUNCTION public.get_vendas_serie_mensal(p_tenant uuid, p_meses integer DEFAULT 12, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(mes date, qtd bigint, new_mrr numeric, ticket numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH ref AS (
    SELECT date_trunc('month', (now() AT TIME ZONE 'America/Sao_Paulo')::date)::date AS m0
  ),
  meses AS (
    SELECT generate_series(
      (SELECT m0 FROM ref) - ((p_meses - 1) || ' months')::interval,
      (SELECT m0 FROM ref),
      '1 month'
    )::date AS mes
  ),
  vendas AS (
    SELECT date_trunc('month', v.data_venda_efetiva)::date AS mes,
           -- corte no fim do mês da própria venda
           public.fn_mrr_cliente_em(
             p_tenant, v.id,
             (date_trunc('month', v.data_venda_efetiva) + interval '1 month' - interval '1 day')::date
           ) AS mrr
    FROM public.vw_clientes_financeiro v
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva >= (SELECT m0 FROM ref) - ((p_meses - 1) || ' months')::interval
      AND v.data_venda_efetiva <  (SELECT m0 FROM ref) + interval '1 month'
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cpf WHERE cpf.cliente_id = v.id AND cpf.tenant_id = p_tenant AND cpf.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
  )
  SELECT m.mes,
         count(v.mrr)::bigint AS qtd,
         COALESCE(round(sum(v.mrr), 2), 0) AS new_mrr,
         CASE WHEN count(v.mrr) > 0 THEN round(sum(v.mrr) / count(v.mrr), 2) ELSE 0 END AS ticket
  FROM meses m
  LEFT JOIN vendas v ON v.mes = m.mes
  GROUP BY m.mes
  ORDER BY m.mes;
$function$;

CREATE OR REPLACE FUNCTION public.get_vendas_ticket_stats(p_tenant uuid, p_ini date, p_fim date, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(n bigint, media numeric, mediana numeric, p25 numeric, p75 numeric, minimo numeric, maximo numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT public.fn_mrr_cliente_em(p_tenant, v.id, p_fim) AS mrr
    FROM public.vw_clientes_financeiro v
    WHERE v.tenant_id = p_tenant
      AND v.data_venda_efetiva BETWEEN p_ini AND p_fim
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR EXISTS (SELECT 1 FROM public.cliente_produtos cpf WHERE cpf.cliente_id = v.id AND cpf.tenant_id = p_tenant AND cpf.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
  )
  SELECT
    count(*)::bigint AS n,
    round(avg(mrr), 2) AS media,
    round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY mrr)::numeric, 2) AS mediana,
    round(percentile_cont(0.25) WITHIN GROUP (ORDER BY mrr)::numeric, 2) AS p25,
    round(percentile_cont(0.75) WITHIN GROUP (ORDER BY mrr)::numeric, 2) AS p75,
    round(min(mrr), 2) AS minimo,
    round(max(mrr), 2) AS maximo
  FROM base
  WHERE mrr > 0;
$function$;

-- ─── Cohort ────────────────────────────────────────────────────────────────
-- `mrr_inicial` era o valor de HOJE do cliente, e `mrr_retido` era o MESMO valor
-- multiplicado por 0/1. Ou seja: revenue retention nunca podia cair por redução de
-- valor, só por saída do cliente — e o cohort inteiro encolhia para trás a cada
-- cancelamento. Agora cada um tem seu corte: entrada no fim do mês do cohort,
-- retenção no fim do mês de referência.
--
-- Set-based de propósito (`prod`/`mov` agregam por cliente × mês) em vez de chamar
-- a função por linha: são ~1,4k movimentos e ~5k produtos contra até 36 meses.

CREATE OR REPLACE FUNCTION public.fn_cohort_revenue(p_from_month date DEFAULT NULL::date, p_to_month date DEFAULT NULL::date, p_max_age integer DEFAULT 36, p_fornecedor_id bigint DEFAULT NULL::bigint, p_unidade_base_id bigint DEFAULT NULL::bigint, p_tenant_id uuid DEFAULT NULL::uuid, p_dimensao text DEFAULT NULL::text, p_fornecedor_ids bigint[] DEFAULT NULL::bigint[])
 RETURNS TABLE(tenant_id uuid, grupo text, cohort_month date, age_months integer, cohort_size bigint, retained bigint, retention_percent numeric, mrr_inicial numeric, mrr_retido numeric, revenue_retention_percent numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH tid AS (SELECT COALESCE(p_tenant_id, current_tenant_id()) AS t),
clientes_base AS (
    SELECT v.id, v.tenant_id,
        CASE p_dimensao
          WHEN 'canal'    THEN COALESCE(NULLIF(o.nome, ''), '(sem informação)')
          WHEN 'segmento' THEN COALESCE(NULLIF(s.nome, ''), '(sem informação)')
          WHEN 'uf'       THEN COALESCE(NULLIF(e.sigla, ''), '(sem informação)')
          WHEN 'faixa_ticket' THEN CASE
                WHEN COALESCE(v.mensalidade, 0) < 200  THEN 'Até R$ 200'
                WHEN v.mensalidade < 500  THEN 'R$ 200–500'
                WHEN v.mensalidade < 1000 THEN 'R$ 500–1k'
                ELSE 'Acima de R$ 1k' END
          ELSE 'Geral'
        END AS grupo,
        (date_trunc('month', COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro)::timestamp))::date AS cohort_month,
        COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro) AS data_entrada,
        v.cancelado, v.data_cancelamento
    FROM vw_clientes_financeiro v
    LEFT JOIN public.origens_venda o ON o.id = v.origem_venda_id
    LEFT JOIN public.segmentos s ON s.id = v.segmento_id
    LEFT JOIN public.estados e ON e.id = v.estado_id
    WHERE COALESCE(v.data_venda_efetiva, v.data_venda, v.data_ativacao, v.data_cadastro) IS NOT NULL
      AND v.tenant_id = (SELECT t FROM tid)
      AND (p_unidade_base_id IS NULL OR v.unidade_base_id = p_unidade_base_id)
      AND ((SELECT public.is_super_admin()) OR (SELECT public.user_allowed_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_allowed_unidades())::bigint[]))
      AND ((SELECT public.user_view_unidades()) IS NULL OR v.unidade_base_id IS NULL OR v.unidade_base_id = ANY((SELECT public.user_view_unidades())::bigint[]))
      AND (
        COALESCE(p_fornecedor_ids, CASE WHEN p_fornecedor_id IS NOT NULL THEN ARRAY[p_fornecedor_id] ELSE NULL END) IS NULL
        OR v.id IN (SELECT cp.cliente_id FROM public.cliente_produtos cp WHERE cp.tenant_id = (SELECT t FROM tid) AND cp.fornecedor_id = ANY(COALESCE(p_fornecedor_ids, ARRAY[p_fornecedor_id])))
      )
),
meses AS (
    SELECT (generate_series((SELECT min(cohort_month) FROM clientes_base)::timestamp, date_trunc('month', CURRENT_DATE::timestamptz)::timestamp, '1 mon'::interval))::date AS month_ref
),
cortes AS (
    SELECT month_ref, (month_ref + interval '1 mon' - interval '1 day')::date AS fim FROM meses
),
-- valor por (cliente, corte), set-based
prod AS (
    SELECT cp.cliente_id, k.month_ref, SUM(cp.vlr_mensal) AS v
    FROM public.cliente_produtos cp
    JOIN cortes k ON (cp.ativo = true OR cp.data_cancelamento > k.fim)
    WHERE cp.tenant_id = (SELECT t FROM tid)
    GROUP BY 1, 2
),
mov AS (
    SELECT mv.cliente_id, k.month_ref, SUM(mv.valor_delta) AS v
    FROM public.movimentos_mrr mv
    JOIN cortes k ON mv.data_movimento <= k.fim
    WHERE mv.tenant_id = (SELECT t FROM tid)
      AND mv.tipo IN ('upsell','cross_sell','downsell','churn','reactivation','reajuste')
      AND mv.status = 'ativo' AND mv.estornado_por IS NULL AND mv.estorno_de IS NULL
    GROUP BY 1, 2
),
-- Sem CTE intermediária de (cliente × todos os meses): o CROSS JOIN custava 2,7x.
-- Cada consumidor abaixo já tem o seu corte, então liga direto em prod/mov.
cohort_sizes AS (
    SELECT cb.tenant_id, cb.grupo, cb.cohort_month,
           count(DISTINCT cb.id) AS cohort_size,
           sum(COALESCE(p.v, 0) + COALESCE(m.v, 0)) AS mrr_inicial
    FROM clientes_base cb
    LEFT JOIN prod p ON p.cliente_id = cb.id AND p.month_ref = cb.cohort_month
    LEFT JOIN mov  m ON m.cliente_id = cb.id AND m.month_ref = cb.cohort_month
    GROUP BY cb.tenant_id, cb.grupo, cb.cohort_month
),
cohort_age AS (
    SELECT cb.tenant_id, cb.grupo, cb.cohort_month,
        ((EXTRACT(year FROM age(k.month_ref::timestamp, cb.cohort_month::timestamp)) * 12)
         + EXTRACT(month FROM age(k.month_ref::timestamp, cb.cohort_month::timestamp)))::integer AS age_months,
        CASE WHEN cb.data_entrada <= k.fim
                 AND (cb.cancelado <> true OR (cb.data_cancelamento IS NOT NULL AND cb.data_cancelamento > k.fim))
            THEN 1 ELSE 0 END AS is_retained,
        COALESCE(p.v, 0) + COALESCE(m.v, 0) AS mrr_no_mes
    FROM clientes_base cb
    JOIN cortes k ON k.month_ref >= cb.cohort_month
    LEFT JOIN prod p ON p.cliente_id = cb.id AND p.month_ref = k.month_ref
    LEFT JOIN mov  m ON m.cliente_id = cb.id AND m.month_ref = k.month_ref
),
agg AS (
    SELECT ca.tenant_id, ca.grupo, ca.cohort_month, ca.age_months,
        sum(ca.is_retained) AS retained,
        sum(ca.mrr_no_mes * ca.is_retained) AS mrr_retido
    FROM cohort_age ca GROUP BY ca.tenant_id, ca.grupo, ca.cohort_month, ca.age_months
)
SELECT a.tenant_id, a.grupo, a.cohort_month, a.age_months, cs.cohort_size, a.retained,
    round((a.retained::numeric / NULLIF(cs.cohort_size, 0)::numeric) * 100, 2) AS retention_percent,
    round(cs.mrr_inicial, 2) AS mrr_inicial,
    round(a.mrr_retido, 2) AS mrr_retido,
    round((a.mrr_retido / NULLIF(cs.mrr_inicial, 0)) * 100, 2) AS revenue_retention_percent
FROM agg a JOIN cohort_sizes cs ON cs.tenant_id = a.tenant_id AND cs.grupo = a.grupo AND cs.cohort_month = a.cohort_month
WHERE a.age_months >= 0 AND a.age_months <= LEAST(p_max_age, 36)
  AND (p_from_month IS NULL OR a.cohort_month >= p_from_month)
  AND (p_to_month IS NULL OR a.cohort_month <= p_to_month);
$function$;
