DROP VIEW IF EXISTS public.vw_clientes_financeiro;

CREATE VIEW public.vw_clientes_financeiro
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.codigo_sequencial,
  c.razao_social,
  c.nome_fantasia,
  c.cnpj,
  c.email,
  c.telefone_contato,
  c.telefone_whatsapp,
  c.observacao_cliente,
  c.observacao_negociacao,
  c.origem_venda_id,
  c.data_cadastro,
  c.estado_id,
  c.cidade_id,
  c.area_atuacao_id,
  c.segmento_id,
  c.modelo_contrato_id,
  c.unidade_base_id,
  c.data_venda,
  c.data_ativacao,
  c.funcionario_id,
  c.recorrencia,
  c.produto_id,
  c.valor_ativacao,
  c.forma_pagamento_ativacao_id,
  c.mensalidade,
  c.forma_pagamento_mensalidade_id,
  c.custo_operacao,
  c.imposto_percentual,
  c.custo_fixo_percentual,
  c.cancelado,
  c.data_cancelamento,
  c.motivo_cancelamento_id,
  c.observacao_cancelamento,
  c.created_at,
  c.updated_at,
  c.cert_a1_vencimento,
  c.cert_a1_ultima_venda_em,
  c.cert_a1_ultimo_vendedor_id,
  CASE
    WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0::numeric
      THEN round(c.mensalidade * COALESCE(c.imposto_percentual, 0::numeric), 2)
    ELSE 0::numeric
  END AS impostos_rs,
  CASE
    WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0::numeric
      THEN round(c.mensalidade * COALESCE(c.custo_fixo_percentual, 0::numeric), 2)
    ELSE 0::numeric
  END AS fixos_rs,
  COALESCE(c.custo_operacao, 0::numeric) AS valor_repasse,
  CASE
    WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0::numeric
      THEN round(c.mensalidade - COALESCE(c.custo_operacao, 0::numeric), 2)
    ELSE 0::numeric
  END AS lucro_bruto,
  CASE
    WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0::numeric
      THEN round(
        c.mensalidade
        - COALESCE(c.custo_operacao, 0::numeric)
        - round(c.mensalidade * COALESCE(c.imposto_percentual, 0::numeric), 2)
        - round(c.mensalidade * COALESCE(c.custo_fixo_percentual, 0::numeric), 2),
        2
      )
    ELSE 0::numeric
  END AS lucro_real,
  CASE
    WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0::numeric
      THEN round((c.mensalidade - COALESCE(c.custo_operacao, 0::numeric)) / c.mensalidade * 100::numeric, 2)
    ELSE 0::numeric
  END AS margem_bruta_percent,
  CASE
    WHEN c.mensalidade IS NOT NULL AND c.mensalidade > 0::numeric
      THEN round(
        (
          c.mensalidade
          - COALESCE(c.custo_operacao, 0::numeric)
          - round(c.mensalidade * COALESCE(c.imposto_percentual, 0::numeric), 2)
          - round(c.mensalidade * COALESCE(c.custo_fixo_percentual, 0::numeric), 2)
        ) / c.mensalidade * 100::numeric,
        2
      )
    ELSE 0::numeric
  END AS margem_contribuicao,
  CASE
    WHEN COALESCE(c.custo_operacao, 0::numeric) > 0::numeric
      THEN round(c.mensalidade / c.custo_operacao, 2)
    ELSE NULL::numeric
  END AS fator_preco_cogs_x,
  CASE
    WHEN COALESCE(c.custo_operacao, 0::numeric) > 0::numeric
      THEN round((c.mensalidade - c.custo_operacao) / c.custo_operacao * 100::numeric, 2)
    ELSE NULL::numeric
  END AS markup_cogs_percent,
  c.fornecedor_id
FROM public.clientes c;