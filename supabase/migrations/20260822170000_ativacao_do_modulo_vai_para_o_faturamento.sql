-- 22/08/2026 — "Valor Ativação" do módulo passa a chegar no faturamento.
--
-- O campo existia no diálogo de Adicionar Módulo, gravava em
-- cliente_produto_modulos.vlr_ativacao e NINGUÉM lia. Conferido em produção:
-- 4.060 linhas de módulo, todas com vlr_ativacao = 0 — ninguém tinha digitado
-- ainda, por isso o buraco nunca apareceu.
--
-- O fluxo do PRODUTO (que esta migration passa a espelhar) é:
--   valor digitado -> cliente_produtos.vlr_ativacao
--                  -> contrato_itens.vlr_ativacao
--                  -> contratos.vlr_total_ativacao (rollup)
--                  -> vw_clientes_financeiro.valor_ativacao (dashboard/ficha)
--
-- POR QUE O MÓDULO NÃO GANHA LINHA PRÓPRIA NO CONTRATO, que seria o espelho
-- literal (contrato_itens.modulo_id existe e está vazio):
--   `fn_omie_montar_payload_contrato` recusa contrato com mais de um item
--   ("Contrato com multiplos produtos ainda nao e suportado na integracao"), e a
--   elegibilidade da sincronização exige `count(contrato_itens) = 1`. Uma linha
--   por módulo tiraria do Omie todo cliente que tivesse módulo com ativação.
--   Então a ativação do módulo entra SOMADA na linha do produto — mesmo item,
--   mesmo rollup, mesma view.
--
-- O que NÃO muda:
--   * MRR. Ativação não entra em movimentos_mrr, em fn_mrr_cliente_em nem em
--     fn_sync_produto_valores (que só soma vlr_mensal/vlr_custo). Continua assim.
--   * Omie. `ds-omie-contrato-criar` e `ds-omie-contrato-alterar` não leem
--     vlr_ativacao nem contrato_itens; e o gatilho que enfileira o Omie dispara
--     em UPDATE OF vlr_mensal/quantidade/ativo — nunca em vlr_ativacao.

-- ---------------------------------------------------------------- 1) helper
CREATE OR REPLACE FUNCTION public.fn_ativacao_dos_modulos(p_cliente_produto_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Sem filtro de `ativo`, de propósito: é a mesma régua do produto na
  -- vw_clientes_financeiro (`sum(cp.vlr_ativacao)` soma inclusive o cancelado).
  -- Ativação é cobrança única; cancelar o módulo depois não devolve o dinheiro.
  SELECT COALESCE(SUM(COALESCE(vlr_ativacao, 0)), 0)::numeric
    FROM public.cliente_produto_modulos
   WHERE cliente_produto_id = p_cliente_produto_id;
$$;

REVOKE ALL ON FUNCTION public.fn_ativacao_dos_modulos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_ativacao_dos_modulos(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ativacao_dos_modulos(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_ativacao_dos_modulos(uuid) IS
'Soma o Valor Ativação de TODOS os módulos de um cliente_produto (inclusive inativos). Usada para compor contrato_itens.vlr_ativacao.';

-- --------------------------------------- 2) recompor o item e o total do contrato
CREATE OR REPLACE FUNCTION public.fn_sync_ativacao_no_contrato(p_cliente_produto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ativacao numeric;
BEGIN
  SELECT COALESCE(cp.vlr_ativacao, 0) + public.fn_ativacao_dos_modulos(cp.id)
    INTO v_ativacao
    FROM public.cliente_produtos cp
   WHERE cp.id = p_cliente_produto_id;

  IF v_ativacao IS NULL THEN
    RETURN;  -- cliente_produto não existe mais (DELETE em cascata)
  END IF;

  -- `modulo_id IS NULL` = a linha do PRODUTO. Hoje é a única que existe, mas a
  -- coluna está lá e o admin_swap_cliente_produto já a remapeia — sem a guarda,
  -- o dia em que alguém criar uma linha de módulo ela levaria o total do produto.
  UPDATE public.contrato_itens
     SET vlr_ativacao = v_ativacao
   WHERE cliente_produto_id = p_cliente_produto_id
     AND modulo_id IS NULL;

  UPDATE public.contratos c
     SET vlr_total_ativacao = (SELECT COALESCE(SUM(vlr_ativacao), 0)
                                 FROM public.contrato_itens WHERE contrato_id = c.id),
         updated_at = now()
   WHERE c.id IN (SELECT contrato_id FROM public.contrato_itens
                   WHERE cliente_produto_id = p_cliente_produto_id);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_sync_ativacao_no_contrato(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_sync_ativacao_no_contrato(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_ativacao_no_contrato(uuid) TO service_role;

-- ------------------------------------------------------ 3) gatilho no módulo
CREATE OR REPLACE FUNCTION public.trg_ativacao_modulo_no_contrato()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp uuid;
BEGIN
  -- Mesma chave de escape do fn_sync_produto_valores: carga em massa desliga.
  IF current_setting('doctorsaas.skip_valor_sync', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_cp := OLD.cliente_produto_id;
  ELSE
    v_cp := NEW.cliente_produto_id;
  END IF;

  PERFORM public.fn_sync_ativacao_no_contrato(v_cp);

  -- Módulo reapontado para outro produto: o de origem também tem que baixar.
  IF TG_OP = 'UPDATE' AND OLD.cliente_produto_id IS DISTINCT FROM NEW.cliente_produto_id THEN
    PERFORM public.fn_sync_ativacao_no_contrato(OLD.cliente_produto_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_ativacao_modulo_no_contrato ON public.cliente_produto_modulos;
CREATE TRIGGER trg_ativacao_modulo_no_contrato
AFTER INSERT OR DELETE OR UPDATE OF vlr_ativacao, cliente_produto_id
ON public.cliente_produto_modulos
FOR EACH ROW EXECUTE FUNCTION public.trg_ativacao_modulo_no_contrato();

-- ------------------------- 4) edição do produto não pode apagar o do módulo
-- Corpo idêntico ao de produção (baixado hoje via `supabase db dump --linked`),
-- com UMA mudança: a linha do contrato passa a somar a ativação dos módulos.
-- Sem isso, qualquer edição do produto zerava a parte do módulo no contrato.
CREATE OR REPLACE FUNCTION public.sync_cliente_produto_to_contract(p_cliente_produto_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp record;
  v_contrato_id uuid;
  v_is_implicit boolean;
  v_user_tenant uuid;
BEGIN
  SELECT * INTO v_cp FROM cliente_produtos WHERE id = p_cliente_produto_id;
  IF v_cp.id IS NULL THEN
    RAISE EXCEPTION 'cliente_produto nao encontrado';
  END IF;

  SELECT tenant_id INTO v_user_tenant FROM profiles WHERE user_id = auth.uid();
  IF NOT public.is_super_admin() AND (v_user_tenant IS NULL OR v_user_tenant <> v_cp.tenant_id) THEN
    RAISE EXCEPTION 'Sem permissao no tenant do cliente_produto';
  END IF;

  SELECT ci.contrato_id, c.is_implicit
  INTO v_contrato_id, v_is_implicit
  FROM contrato_itens ci
  JOIN contratos c ON c.id = ci.contrato_id
  WHERE ci.cliente_produto_id = p_cliente_produto_id
  LIMIT 1;

  IF v_contrato_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE contrato_itens
  SET vlr_mensal = v_cp.vlr_mensal,
      vlr_ativacao = COALESCE(v_cp.vlr_ativacao, 0) + public.fn_ativacao_dos_modulos(v_cp.id)
  WHERE cliente_produto_id = p_cliente_produto_id;

  IF v_is_implicit THEN
    UPDATE contratos
    SET
      data_venda = v_cp.data_venda,
      data_inicio = v_cp.data_ativacao,
      data_fim = v_cp.data_fim,
      data_proximo_reajuste = v_cp.data_proximo_reajuste,
      prazo_meses = v_cp.prazo_meses,
      dia_vencimento = v_cp.dia_vencimento,
      modelo_contrato_id = v_cp.modelo_contrato_id,
      recorrencia = v_cp.recorrencia,
      funcionario_id = v_cp.funcionario_id,
      origem_venda_id = v_cp.origem_venda_id,
      forma_pagamento_ativacao_id = v_cp.forma_pagamento_ativacao_id,
      forma_pagamento_mensalidade_id = v_cp.forma_pagamento_mensalidade_id,
      observacoes = v_cp.observacoes_contratuais,
      updated_at = now()
    WHERE id = v_contrato_id;
  END IF;

  UPDATE contratos c
  SET
    vlr_total_mensal = (SELECT COALESCE(SUM(vlr_mensal), 0) FROM contrato_itens WHERE contrato_id = c.id),
    vlr_total_ativacao = (SELECT COALESCE(SUM(vlr_ativacao), 0) FROM contrato_itens WHERE contrato_id = c.id),
    updated_at = now()
  WHERE c.id = v_contrato_id;
END;
$$;

COMMENT ON FUNCTION public.sync_cliente_produto_to_contract(uuid) IS
'Propaga edicao de cliente_produto para contrato vinculado. Se contrato eh implicito, atualiza tudo. Se eh aditivo (is_implicit=false), atualiza apenas vlr_mensal/vlr_ativacao do item. 22/08/2026: vlr_ativacao do item = ativacao do produto + ativacao dos modulos.';

-- --------------------------------------------------------------- 5) backfill
-- Hoje soma zero (nenhum módulo tem ativação preenchida). Fica aqui porque a
-- migration pode ser aplicada dias depois de alguém digitar o primeiro valor.
UPDATE public.contrato_itens ci
   SET vlr_ativacao = COALESCE(cp.vlr_ativacao, 0) + public.fn_ativacao_dos_modulos(cp.id)
  FROM public.cliente_produtos cp
 WHERE cp.id = ci.cliente_produto_id
   AND ci.modulo_id IS NULL
   AND ci.vlr_ativacao IS DISTINCT FROM
       (COALESCE(cp.vlr_ativacao, 0) + public.fn_ativacao_dos_modulos(cp.id));

UPDATE public.contratos c
   SET vlr_total_ativacao = (SELECT COALESCE(SUM(vlr_ativacao), 0)
                               FROM public.contrato_itens WHERE contrato_id = c.id)
 WHERE c.vlr_total_ativacao IS DISTINCT FROM
       (SELECT COALESCE(SUM(vlr_ativacao), 0)
          FROM public.contrato_itens WHERE contrato_id = c.id);

-- ------------------------------------------- 6) a ficha/dashboard do cliente
-- `valor_ativacao` da view alimenta o Total Implantação e o Setup Médio do
-- dashboard de Vendas e o card financeiro do cliente. Idêntica à de produção,
-- com um LEFT JOIN LATERAL somando a ativação dos módulos de cada produto.
CREATE OR REPLACE VIEW "public"."vw_clientes_financeiro" WITH ("security_invoker"='on') AS
 SELECT "c"."id",
    "c"."codigo_sequencial",
    "c"."razao_social",
    "c"."nome_fantasia",
    "c"."cnpj",
    "c"."email",
    "c"."telefone_contato",
    "c"."telefone_whatsapp",
    "c"."observacao_cliente",
    "c"."observacao_negociacao",
    "cta"."origem_venda_id",
    "c"."data_cadastro",
    "c"."estado_id",
    "c"."cidade_id",
    "c"."area_atuacao_id",
    "c"."segmento_id",
    "cta"."modelo_contrato_id",
    "c"."unidade_base_id",
    "cta"."data_venda",
    "cpa"."min_data_ativacao" AS "data_ativacao",
    "cta"."funcionario_id",
    "cta"."recorrencia",
    "cpa"."produto_id",
    "cpa"."total_vlr_ativacao" AS "valor_ativacao",
    "cta"."forma_pagamento_ativacao_id",
    COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) AS "mensalidade",
    "cta"."forma_pagamento_mensalidade_id",
    COALESCE("cpa"."soma_vlr_custo", (0)::numeric) AS "custo_operacao",
    "c"."imposto_percentual",
    "c"."custo_fixo_percentual",
    "c"."cancelado",
    "c"."data_cancelamento",
    "c"."motivo_cancelamento_id",
    "c"."observacao_cancelamento",
    "c"."created_at",
    "c"."updated_at",
    "c"."cert_a1_vencimento",
    "c"."cert_a1_ultima_venda_em",
    "c"."cert_a1_ultimo_vendedor_id",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) > (0)::numeric) THEN "round"(("cpa"."soma_vlr_mensal" * COALESCE("c"."imposto_percentual", (0)::numeric)), 2)
            ELSE (0)::numeric
        END AS "impostos_rs",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) > (0)::numeric) THEN "round"(("cpa"."soma_vlr_mensal" * COALESCE("c"."custo_fixo_percentual", (0)::numeric)), 2)
            ELSE (0)::numeric
        END AS "fixos_rs",
    COALESCE("cpa"."soma_vlr_custo", (0)::numeric) AS "valor_repasse",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) > (0)::numeric) THEN "round"(("cpa"."soma_vlr_mensal" - COALESCE("cpa"."soma_vlr_custo", (0)::numeric)), 2)
            ELSE (0)::numeric
        END AS "lucro_bruto",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) > (0)::numeric) THEN "round"(((("cpa"."soma_vlr_mensal" - COALESCE("cpa"."soma_vlr_custo", (0)::numeric)) - "round"(("cpa"."soma_vlr_mensal" * COALESCE("c"."imposto_percentual", (0)::numeric)), 2)) - "round"(("cpa"."soma_vlr_mensal" * COALESCE("c"."custo_fixo_percentual", (0)::numeric)), 2)), 2)
            ELSE (0)::numeric
        END AS "lucro_real",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) > (0)::numeric) THEN "round"(((("cpa"."soma_vlr_mensal" - COALESCE("cpa"."soma_vlr_custo", (0)::numeric)) / "cpa"."soma_vlr_mensal") * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "margem_bruta_percent",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_mensal", (0)::numeric) > (0)::numeric) THEN "round"(((((("cpa"."soma_vlr_mensal" - COALESCE("cpa"."soma_vlr_custo", (0)::numeric)) - "round"(("cpa"."soma_vlr_mensal" * COALESCE("c"."imposto_percentual", (0)::numeric)), 2)) - "round"(("cpa"."soma_vlr_mensal" * COALESCE("c"."custo_fixo_percentual", (0)::numeric)), 2)) / "cpa"."soma_vlr_mensal") * (100)::numeric), 2)
            ELSE (0)::numeric
        END AS "margem_contribuicao",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_custo", (0)::numeric) > (0)::numeric) THEN "round"(("cpa"."soma_vlr_mensal" / "cpa"."soma_vlr_custo"), 2)
            ELSE NULL::numeric
        END AS "fator_preco_cogs_x",
        CASE
            WHEN (COALESCE("cpa"."soma_vlr_custo", (0)::numeric) > (0)::numeric) THEN "round"(((("cpa"."soma_vlr_mensal" - "cpa"."soma_vlr_custo") / "cpa"."soma_vlr_custo") * (100)::numeric), 2)
            ELSE NULL::numeric
        END AS "markup_cogs_percent",
    "cpa"."fornecedor_id",
    "c"."tenant_id",
    "cpa"."data_proximo_reajuste" AS "data_reajuste",
    "c"."data_reativacao",
    "c"."reativado_por_user_id",
    "c"."observacao_reativacao",
    COALESCE("cta"."min_data_venda", "c"."data_cadastro") AS "data_venda_efetiva",
    COALESCE("cta"."qtde_contratos_ativos", (0)::bigint) AS "qtde_contratos_ativos",
    "c"."setup_completo",
    COALESCE("cpa"."qtde_produtos_ativos", (0)::bigint) AS "qtde_produtos_ativos",
    "c"."cnpj_digits"
   FROM (("public"."clientes" "c"
     LEFT JOIN LATERAL ( SELECT "sum"(COALESCE("cp"."vlr_mensal", (0)::numeric)) FILTER (WHERE ("cp"."ativo" = true)) AS "soma_vlr_mensal",
            "sum"(COALESCE("cp"."vlr_custo", (0)::numeric)) FILTER (WHERE ("cp"."ativo" = true)) AS "soma_vlr_custo",
            "sum"((COALESCE("cp"."vlr_ativacao", (0)::numeric) + COALESCE("cpm"."soma_ativacao_modulos", (0)::numeric))) AS "total_vlr_ativacao",
            "min"("cp"."data_ativacao") AS "min_data_ativacao",
            "count"(*) FILTER (WHERE ("cp"."ativo" = true)) AS "qtde_produtos_ativos",
            ("array_agg"("cp"."produto_id" ORDER BY "cp"."ativo" DESC, "cp"."vlr_mensal" DESC NULLS LAST))[1] AS "produto_id",
            ("array_agg"("cp"."fornecedor_id" ORDER BY "cp"."ativo" DESC, "cp"."vlr_mensal" DESC NULLS LAST))[1] AS "fornecedor_id",
            ("array_agg"("cp"."data_proximo_reajuste" ORDER BY "cp"."ativo" DESC, "cp"."vlr_mensal" DESC NULLS LAST))[1] AS "data_proximo_reajuste"
           FROM ("public"."cliente_produtos" "cp"
             LEFT JOIN LATERAL ( SELECT "sum"(COALESCE("m"."vlr_ativacao", (0)::numeric)) AS "soma_ativacao_modulos"
                   FROM "public"."cliente_produto_modulos" "m"
                  WHERE ("m"."cliente_produto_id" = "cp"."id")) "cpm" ON (true))
          WHERE ("cp"."cliente_id" = "c"."id")) "cpa" ON (true))
     LEFT JOIN LATERAL ( SELECT "min"("ct"."data_venda") AS "min_data_venda",
            "count"(*) FILTER (WHERE ("ct"."status" = 'ativo'::"text")) AS "qtde_contratos_ativos",
            ("array_agg"("ct"."funcionario_id" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "funcionario_id",
            ("array_agg"("ct"."origem_venda_id" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "origem_venda_id",
            ("array_agg"("ct"."data_venda" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "data_venda",
            ("array_agg"("ct"."recorrencia" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "recorrencia",
            ("array_agg"("ct"."modelo_contrato_id" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "modelo_contrato_id",
            ("array_agg"("ct"."forma_pagamento_ativacao_id" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "forma_pagamento_ativacao_id",
            ("array_agg"("ct"."forma_pagamento_mensalidade_id" ORDER BY ("ct"."status" = 'ativo'::"text") DESC, "ct"."data_venda"))[1] AS "forma_pagamento_mensalidade_id"
           FROM "public"."contratos" "ct"
          WHERE ("ct"."cliente_id" = "c"."id")) "cta" ON (true));


