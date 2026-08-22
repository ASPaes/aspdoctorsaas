-- ============================================================================
-- 22/08/2026 — "Valor Ativação" no movimento de MRR.
--
-- O diálogo de Movimentos de MRR só sabia lançar valor recorrente. Quando a
-- venda tem taxa de setup (upsell/cross-sell com implantação), o operador não
-- tinha onde pôr o valor: ou ele somava no MRR — e o cliente passava a "valer"
-- para sempre uma cobrança única —, ou o valor não entrava em lugar nenhum.
--
-- É o mesmo campo que a linha de produto (`cliente_produtos.vlr_ativacao`) e o
-- módulo (`cliente_produto_modulos.vlr_ativacao`) já têm.
--
-- POR QUE A COLUNA NOVA NÃO REPETE O CAMINHO DO PRODUTO
-- (`contrato_itens.vlr_ativacao` -> `contratos.vlr_total_ativacao` ->
--  `vw_clientes_financeiro.valor_ativacao`):
--
--   Esse caminho é ancorado no CLIENTE, sem data própria — o dashboard só conta
--   a ativação de quem foi VENDIDO no mês (`data_venda_efetiva`). Upsell e
--   cross-sell, por definição, acontecem em cliente que já existe: a ativação
--   lançada por aqui cairia num campo que nenhum número do período lê. Foi
--   exatamente o buraco do "Valor Ativação" do módulo, corrigido hoje de manhã.
--
--   Então a ativação do movimento tem data: é a `data_movimento`, e é por ela
--   que o dashboard soma (KPI "Receita de Ativação" e a série de Faturamento).
--   `contrato_itens` e `contratos` NÃO são tocados — e por isso o Omie também
--   não é: `fn_omie_montar_payload_contrato` não lê `vlr_ativacao`.
--
-- O QUE NÃO MUDA:
--   * MRR. `fn_mrr_cliente_em`, `calcular_mrr_cliente` e `get_mrr_bridge` leem
--     `valor_delta`; nenhuma delas conhece esta coluna.
--   * Fila do Omie. O gatilho `movimento_mrr_enfileirar_omie` dispara em
--     `AFTER INSERT OR UPDATE OF status, valor_delta, estornado_por, estorno_de,
--     encerrado_em` — `vlr_ativacao` fica de fora de propósito: corrigir a
--     ativação de um movimento não altera o valor do contrato no Omie.
--   * Nenhum INSERT existente quebra: as 6 funções que gravam em movimentos_mrr
--     nomeiam as colunas, e a nova tem DEFAULT.
-- ============================================================================

ALTER TABLE public.movimentos_mrr
  ADD COLUMN IF NOT EXISTS vlr_ativacao numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.movimentos_mrr.vlr_ativacao IS
'Taxa de ativação/setup lançada junto do movimento. Cobrança ÚNICA: não entra no MRR (nem no saldo, nem no Net New) e não vai ao Omie. Conta como faturamento no mês da data_movimento — KPI "Receita de Ativação" e série de Faturamento do dashboard de Vendas, e "Total Ativação" na ficha do cliente.';

-- Cobrança única não é negativa. Downsell inverte `valor_delta`, nunca isto.
ALTER TABLE public.movimentos_mrr
  DROP CONSTRAINT IF EXISTS movimentos_mrr_vlr_ativacao_nao_negativo;
ALTER TABLE public.movimentos_mrr
  ADD CONSTRAINT movimentos_mrr_vlr_ativacao_nao_negativo
  CHECK (vlr_ativacao >= 0);

-- ---------------------------------------------------------------- a listagem
-- `vw_movimentos_mrr` alimenta a aba global de Movimentos de MRR e a exportação.
-- Corpo idêntico ao de produção (baixado hoje com `supabase db dump --linked`),
-- com a coluna nova APENSADA no fim — CREATE OR REPLACE não aceita mexer na
-- ordem nem no tipo das que já existem.
CREATE OR REPLACE VIEW "public"."vw_movimentos_mrr" WITH ("security_invoker"='true') AS
 SELECT "m"."id",
    "m"."cliente_id",
    "m"."tipo",
    "m"."data_movimento",
    "m"."valor_delta",
    "m"."custo_delta",
    "m"."valor_venda_avulsa",
    "m"."origem_venda",
    "m"."descricao",
    "m"."funcionario_id",
    "m"."status",
    "m"."estorno_de",
    "m"."estornado_por",
    "m"."inativado_em",
    "m"."inativado_por_id",
    "m"."criado_em",
    "m"."tenant_id",
    "m"."cliente_produto_modulo_id",
    "m"."contrato_id",
    "m"."fornecedor_id",
    COALESCE("m"."fornecedor_id", "fp"."fornecedor_id") AS "fornecedor_efetivo",
    "c"."razao_social" AS "cliente_razao_social",
    "c"."nome_fantasia" AS "cliente_nome_fantasia",
    "f"."nome" AS "funcionario_nome",
    "m"."vlr_ativacao"
   FROM ((("public"."movimentos_mrr" "m"
     LEFT JOIN "public"."clientes" "c" ON (("c"."id" = "m"."cliente_id")))
     LEFT JOIN "public"."funcionarios" "f" ON (("f"."id" = "m"."funcionario_id")))
     LEFT JOIN LATERAL ( SELECT "cp"."fornecedor_id"
           FROM "public"."cliente_produtos" "cp"
          WHERE (("cp"."cliente_id" = "m"."cliente_id") AND ("cp"."fornecedor_id" IS NOT NULL))
          ORDER BY "cp"."ativo" DESC, "cp"."created_at" DESC, "cp"."id" DESC
         LIMIT 1) "fp" ON (true));

ALTER VIEW "public"."vw_movimentos_mrr" OWNER TO "postgres";
