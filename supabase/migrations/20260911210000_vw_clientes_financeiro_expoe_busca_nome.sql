-- A busca da tela de Clientes parou de achar QUALQUER cliente (nome, CNPJ, codigo).
--
-- 11/09/2026: a migration 20260911190000 criou `clientes.busca_nome` e a tela passou
-- a filtrar por ela dentro de um `.or(...)`. Mas a tela de Clientes NAO le a tabela:
-- as 4 queries dela (lista, contagem, Novos no Mes, Ticket Medio) leem a VIEW
-- `vw_clientes_financeiro`, e a view tem lista explicita de colunas — `busca_nome`
-- ficou de fora. O PostgREST devolve 400 ("column does not exist"), as 4 queries
-- quebram juntas e a tela mostra lista vazia com os KPIs zerados. Por isso parecia
-- que a busca nao achava nada: nao era zero resultado, era erro.
--
-- As outras telas que usam `busca_nome` (CertificadosA1, SupportTickets,
-- GroupLinkClienteModal, EscolherClienteOemDialog) leem `clientes` direto e nunca
-- quebraram — foi so aqui.
--
-- Coluna acrescentada no FIM da lista: e o que CREATE OR REPLACE VIEW aceita sem
-- precisar dropar (drop levaria junto as policies e grants dos dependentes).
-- `security_invoker` declarado explicito porque o event trigger
-- trg_enforce_view_security_invoker exige.

CREATE OR REPLACE VIEW public.vw_clientes_financeiro
WITH (security_invoker = on) AS
 SELECT c.id,
    c.codigo_sequencial,
    c.razao_social,
    c.nome_fantasia,
    c.cnpj,
    c.email,
    c.telefone_contato,
    c.telefone_whatsapp,
    c.observacao_cliente,
    c.observacao_negociacao,
    cta.origem_venda_id,
    c.data_cadastro,
    c.estado_id,
    c.cidade_id,
    c.area_atuacao_id,
    c.segmento_id,
    cta.modelo_contrato_id,
    c.unidade_base_id,
    cta.data_venda,
    cpa.min_data_ativacao AS data_ativacao,
    cta.funcionario_id,
    cta.recorrencia,
    cpa.produto_id,
    cpa.total_vlr_ativacao AS valor_ativacao,
    cta.forma_pagamento_ativacao_id,
    COALESCE(cpa.soma_vlr_mensal, 0::numeric) AS mensalidade,
    cta.forma_pagamento_mensalidade_id,
    COALESCE(cpa.soma_vlr_custo, 0::numeric) AS custo_operacao,
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
            WHEN COALESCE(cpa.soma_vlr_mensal, 0::numeric) > 0::numeric THEN round(cpa.soma_vlr_mensal * COALESCE(c.imposto_percentual, 0::numeric), 2)
            ELSE 0::numeric
        END AS impostos_rs,
        CASE
            WHEN COALESCE(cpa.soma_vlr_mensal, 0::numeric) > 0::numeric THEN round(cpa.soma_vlr_mensal * COALESCE(c.custo_fixo_percentual, 0::numeric), 2)
            ELSE 0::numeric
        END AS fixos_rs,
    COALESCE(cpa.soma_vlr_custo, 0::numeric) AS valor_repasse,
        CASE
            WHEN COALESCE(cpa.soma_vlr_mensal, 0::numeric) > 0::numeric THEN round(cpa.soma_vlr_mensal - COALESCE(cpa.soma_vlr_custo, 0::numeric), 2)
            ELSE 0::numeric
        END AS lucro_bruto,
        CASE
            WHEN COALESCE(cpa.soma_vlr_mensal, 0::numeric) > 0::numeric THEN round(cpa.soma_vlr_mensal - COALESCE(cpa.soma_vlr_custo, 0::numeric) - round(cpa.soma_vlr_mensal * COALESCE(c.imposto_percentual, 0::numeric), 2) - round(cpa.soma_vlr_mensal * COALESCE(c.custo_fixo_percentual, 0::numeric), 2), 2)
            ELSE 0::numeric
        END AS lucro_real,
        CASE
            WHEN COALESCE(cpa.soma_vlr_mensal, 0::numeric) > 0::numeric THEN round((cpa.soma_vlr_mensal - COALESCE(cpa.soma_vlr_custo, 0::numeric)) / cpa.soma_vlr_mensal * 100::numeric, 2)
            ELSE 0::numeric
        END AS margem_bruta_percent,
        CASE
            WHEN COALESCE(cpa.soma_vlr_mensal, 0::numeric) > 0::numeric THEN round((cpa.soma_vlr_mensal - COALESCE(cpa.soma_vlr_custo, 0::numeric) - round(cpa.soma_vlr_mensal * COALESCE(c.imposto_percentual, 0::numeric), 2) - round(cpa.soma_vlr_mensal * COALESCE(c.custo_fixo_percentual, 0::numeric), 2)) / cpa.soma_vlr_mensal * 100::numeric, 2)
            ELSE 0::numeric
        END AS margem_contribuicao,
        CASE
            WHEN COALESCE(cpa.soma_vlr_custo, 0::numeric) > 0::numeric THEN round(cpa.soma_vlr_mensal / cpa.soma_vlr_custo, 2)
            ELSE NULL::numeric
        END AS fator_preco_cogs_x,
        CASE
            WHEN COALESCE(cpa.soma_vlr_custo, 0::numeric) > 0::numeric THEN round((cpa.soma_vlr_mensal - cpa.soma_vlr_custo) / cpa.soma_vlr_custo * 100::numeric, 2)
            ELSE NULL::numeric
        END AS markup_cogs_percent,
    cpa.fornecedor_id,
    c.tenant_id,
    cpa.data_proximo_reajuste AS data_reajuste,
    c.data_reativacao,
    c.reativado_por_user_id,
    c.observacao_reativacao,
    COALESCE(cta.min_data_venda, c.data_cadastro) AS data_venda_efetiva,
    COALESCE(cta.qtde_contratos_ativos, 0::bigint) AS qtde_contratos_ativos,
    c.setup_completo,
    COALESCE(cpa.qtde_produtos_ativos, 0::bigint) AS qtde_produtos_ativos,
    c.cnpj_digits,
    c.busca_nome
   FROM clientes c
     LEFT JOIN LATERAL ( SELECT sum(COALESCE(cp.vlr_mensal, 0::numeric)) FILTER (WHERE cp.ativo = true) AS soma_vlr_mensal,
            sum(COALESCE(cp.vlr_custo, 0::numeric)) FILTER (WHERE cp.ativo = true) AS soma_vlr_custo,
            sum(COALESCE(cp.vlr_ativacao, 0::numeric) + COALESCE(cpm.soma_ativacao_modulos, 0::numeric)) AS total_vlr_ativacao,
            min(cp.data_ativacao) AS min_data_ativacao,
            count(*) FILTER (WHERE cp.ativo = true) AS qtde_produtos_ativos,
            (array_agg(cp.produto_id ORDER BY cp.ativo DESC, cp.vlr_mensal DESC NULLS LAST))[1] AS produto_id,
            (array_agg(cp.fornecedor_id ORDER BY cp.ativo DESC, cp.vlr_mensal DESC NULLS LAST))[1] AS fornecedor_id,
            (array_agg(cp.data_proximo_reajuste ORDER BY cp.ativo DESC, cp.vlr_mensal DESC NULLS LAST))[1] AS data_proximo_reajuste
           FROM cliente_produtos cp
             LEFT JOIN LATERAL ( SELECT sum(COALESCE(m.vlr_ativacao, 0::numeric)) AS soma_ativacao_modulos
                   FROM cliente_produto_modulos m
                  WHERE m.cliente_produto_id = cp.id) cpm ON true
          WHERE cp.cliente_id = c.id) cpa ON true
     LEFT JOIN LATERAL ( SELECT min(ct.data_venda) AS min_data_venda,
            count(*) FILTER (WHERE ct.status = 'ativo'::text) AS qtde_contratos_ativos,
            (array_agg(ct.funcionario_id ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS funcionario_id,
            (array_agg(ct.origem_venda_id ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS origem_venda_id,
            (array_agg(ct.data_venda ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS data_venda,
            (array_agg(ct.recorrencia ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS recorrencia,
            (array_agg(ct.modelo_contrato_id ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS modelo_contrato_id,
            (array_agg(ct.forma_pagamento_ativacao_id ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS forma_pagamento_ativacao_id,
            (array_agg(ct.forma_pagamento_mensalidade_id ORDER BY (ct.status = 'ativo'::text) DESC, ct.data_venda))[1] AS forma_pagamento_mensalidade_id
           FROM contratos ct
          WHERE ct.cliente_id = c.id) cta ON true;

COMMENT ON COLUMN public.vw_clientes_financeiro.busca_nome IS
  'Espelha clientes.busca_nome. A tela de Clientes filtra por ela via PostgREST; sem esta coluna as 4 queries da tela quebram juntas.';
