-- Produto novo já nasce com os módulos contratados (24/09/2026).
--
-- Até aqui o "Adicionar Produto" criava produto + contrato e os módulos só
-- entravam depois, um a um, pelo "Adicionar módulo" — que é o caminho do
-- UP-SELL: lança movimento de upsell e, com licença, passa pela fila do OEM.
-- Venda inicial não é up-sell. Os módulos passam a ir em p_dados->'modulos' e
-- nascem na MESMA transação do produto.
--
-- Regras, todas medidas contra produção antes de escrever:
--
-- 1) MRR. O valor mensal por módulo é opcional e só fica registrado. Não
--    precisa de chave nenhuma: fn_sync_produto_valores só troca o MRR do
--    produto pela soma quando TODOS os módulos ativos têm valor, e na venda
--    nova isso não acontece (regra do Alexandre, 24/09). Nenhum movimento de
--    upsell nasce aqui: é a base da venda.
--
-- 2) skip_valor_sync fica DESLIGADO de propósito: é o mesmo gatilho que soma
--    o custo dos módulos do OEM no Custo Operação do produto.
--
-- 3) Omie. Todo módulo gravado enfileira o contrato ativo no Omie
--    (trg_valor_enfileirar_omie). O contrato acabou de nascer e quem decide
--    mandar é a pessoa, no passo seguinte da tela. doctorsaas.intake_hold_omie
--    segura só esse gatilho — é a mesma chave da calculadora.
--
-- 4) OEM. Produto com de/para no OEM (conta da unidade do cliente) grava a
--    linha com origem 'oem' e o custo da tabela do parceiro. Com qualquer
--    outra origem a carga do espelho congela a linha quando a licença chegar
--    (defeito da calculadora corrigido em 4f936a06). A procedência vai em
--    cliente_produto_modulo_eventos.fonte = 'venda_inicial'.
--
-- 5) A tabela de custo sai de UMA função, fn_oem_tabela_do_produto, usada pela
--    tela e pela gravação: as duas nunca mostram números diferentes.

------------------------------------------------------------------------------
-- Custo de tabela do OEM para os módulos de um produto, no contexto do cliente
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_oem_tabela_do_produto(p_cliente_id uuid, p_produto_id bigint)
RETURNS TABLE (modulo_id uuid, oem_modulo_codigo integer, valor_unitario numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  uuid;
  v_unidade bigint;
  v_conta   uuid;
  v_oem_prod text;
BEGIN
  SELECT c.tenant_id, c.unidade_base_id INTO v_tenant, v_unidade
    FROM clientes c WHERE c.id = p_cliente_id;
  IF v_tenant IS NULL THEN RETURN; END IF;

  -- coalesce POR FORA da expressão inteira: is_super_admin() devolve NULL
  -- para quem não tem perfil, e NOT NULL não dispara o IF.
  IF NOT coalesce(
       current_setting('role', true) = 'service_role'
       OR public.is_super_admin()
       OR v_tenant = (SELECT p.tenant_id FROM profiles p WHERE p.user_id = auth.uid() LIMIT 1),
       false) THEN
    RAISE EXCEPTION 'Sem permissao no tenant do cliente';
  END IF;

  -- Conta do OEM que atende a unidade do cliente (NULL = todas as unidades).
  SELECT i.id INTO v_conta
    FROM oem_integration i
   WHERE i.tenant_id = v_tenant AND i.ativo = true
     AND (i.unidades_base_ids IS NULL OR v_unidade = ANY(i.unidades_base_ids))
   ORDER BY i.criado_em
   LIMIT 1;
  IF v_conta IS NULL THEN RETURN; END IF;

  -- Produto do parceiro deste produto. Com duas colunas no de/para (GESTAO
  -- LEGAL e FULL) vence a de mais licenças ativas — mesma regra da calculadora.
  SELECT v.produto_codigo INTO v_oem_prod
    FROM oem_produto_vinculo v
    LEFT JOIN LATERAL (
      SELECT count(*) AS n FROM oem_espelho_filial f
       WHERE f.conta_integration_id = v.conta_integration_id
         AND f.status = 'Ativo' AND f.produto_principal = v.produto_nome) u ON true
   WHERE v.conta_integration_id = v_conta
     AND v.produto_id = p_produto_id
   ORDER BY u.n DESC, v.produto_codigo
   LIMIT 1;
  IF v_oem_prod IS NULL THEN RETURN; END IF;

  -- Casa por CÓDIGO, nunca por nome ("Licença PDV" × "PDV/Comandas").
  RETURN QUERY
    SELECT pm.id, pm.oem_modulo_codigo,
           (SELECT pr.valor_unitario FROM oem_espelho_modulo_preco pr
             WHERE pr.conta_integration_id = v_conta
               AND pr.produto_codigo = v_oem_prod
               AND pr.modulo_codigo = pm.oem_modulo_codigo
             LIMIT 1)
      FROM produto_modulos pm
     WHERE pm.produto_id = p_produto_id
       AND pm.tenant_id = v_tenant
       AND pm.oem_modulo_codigo IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_oem_tabela_do_produto(uuid, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_tabela_do_produto(uuid, bigint) TO authenticated, service_role;

------------------------------------------------------------------------------
-- create_cliente_produto_with_contract: corpo de PRODUÇÃO (24/09/2026) +
-- bloco de módulos no fim. Mesma assinatura: sem sobrecarga, grants mantidos.
-- Única outra mudança: o portão ganhou coalesce (is_super_admin() NULL
-- deixava o IF sem disparar).
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cliente_produto_with_contract(p_cliente_id uuid, p_produto_id bigint, p_dados jsonb, p_link_to_contrato_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_cliente_tenant uuid;
  v_user_tenant uuid;
  v_produto_tenant uuid;
  v_fornecedor_id bigint;
  v_cliente_produto_id uuid;
  v_contrato_id uuid;
  v_data_ativacao date;
  v_data_venda date;
  v_prazo_meses integer;
  v_data_proximo_reajuste date;
  v_vlr_mensal numeric;
  v_vlr_ativacao numeric;
  v_descricao text;
  -- módulos da venda inicial
  v_mod        jsonb;
  v_modulo_id  uuid;
  v_qtd        integer;
  v_mensal_mod numeric;
  v_pm         record;
  v_tab_id     uuid;
  v_tab_preco  numeric;
  v_eh_oem     boolean;
  v_vistos     uuid[] := '{}';
  v_prev_fonte text;
  v_prev_hold  text;
BEGIN
  SELECT tenant_id INTO v_cliente_tenant FROM clientes WHERE id = p_cliente_id;
  IF v_cliente_tenant IS NULL THEN
    RAISE EXCEPTION 'Cliente nao encontrado';
  END IF;

  SELECT tenant_id INTO v_user_tenant FROM profiles WHERE user_id = auth.uid();

  IF NOT coalesce(public.is_super_admin(), false)
     AND current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND (v_user_tenant IS NULL OR v_user_tenant <> v_cliente_tenant) THEN
    RAISE EXCEPTION 'Sem permissao no tenant do cliente';
  END IF;

  v_tenant_id := v_cliente_tenant;

  SELECT tenant_id INTO v_produto_tenant FROM produtos WHERE id = p_produto_id;
  IF v_produto_tenant IS NULL THEN
    RAISE EXCEPTION 'Produto nao encontrado';
  END IF;
  IF v_produto_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'Produto pertence a outro tenant';
  END IF;

  v_fornecedor_id := NULLIF((p_dados->>'fornecedor_id')::text, '')::bigint;
  v_data_ativacao := COALESCE((p_dados->>'data_ativacao')::date, CURRENT_DATE);
  v_data_venda := COALESCE((p_dados->>'data_venda')::date, v_data_ativacao);
  v_prazo_meses := NULLIF((p_dados->>'prazo_meses')::text, '')::integer;
  -- Respeita data de proximo reajuste informada manualmente; calcula automaticamente apenas quando vazia
  v_data_proximo_reajuste := COALESCE(
    NULLIF(p_dados->>'data_proximo_reajuste','')::date,
    public.calc_proximo_reajuste(v_data_ativacao, v_prazo_meses)
  );
  v_vlr_mensal := COALESCE((p_dados->>'vlr_mensal')::numeric, 0);
  v_vlr_ativacao := COALESCE((p_dados->>'vlr_ativacao')::numeric, 0);
  v_descricao := COALESCE(p_dados->>'descricao', (SELECT nome FROM produtos WHERE id = p_produto_id));

  INSERT INTO cliente_produtos (
    tenant_id, cliente_id, produto_id, fornecedor_id, codigo_fornecedor, link_portal_fornecedor,
    vlr_ativacao, vlr_mensal, vlr_custo,
    data_ativacao, data_venda, data_fim, data_proximo_reajuste,
    prazo_meses, dia_vencimento,
    modelo_contrato_id, recorrencia, funcionario_id, origem_venda_id,
    forma_pagamento_ativacao_id, forma_pagamento_mensalidade_id,
    observacoes_contratuais, ativo
  ) VALUES (
    v_tenant_id, p_cliente_id, p_produto_id, v_fornecedor_id,
    p_dados->>'codigo_fornecedor', p_dados->>'link_portal_fornecedor',
    v_vlr_ativacao, v_vlr_mensal, COALESCE((p_dados->>'vlr_custo')::numeric, 0),
    v_data_ativacao, v_data_venda, (p_dados->>'data_fim')::date, v_data_proximo_reajuste,
    v_prazo_meses, NULLIF((p_dados->>'dia_vencimento')::text, '')::integer,
    NULLIF((p_dados->>'modelo_contrato_id')::text, '')::bigint,
    NULLIF(p_dados->>'recorrencia', '')::recorrencia_tipo,
    NULLIF((p_dados->>'funcionario_id')::text, '')::bigint,
    NULLIF((p_dados->>'origem_venda_id')::text, '')::bigint,
    NULLIF((p_dados->>'forma_pagamento_ativacao_id')::text, '')::bigint,
    NULLIF((p_dados->>'forma_pagamento_mensalidade_id')::text, '')::bigint,
    p_dados->>'observacoes_contratuais', true
  ) RETURNING id INTO v_cliente_produto_id;

  IF p_link_to_contrato_id IS NOT NULL THEN
    SELECT id INTO v_contrato_id
    FROM contratos
    WHERE id = p_link_to_contrato_id AND cliente_id = p_cliente_id AND tenant_id = v_tenant_id;
    IF v_contrato_id IS NULL THEN
      RAISE EXCEPTION 'Contrato base invalido ou de outro cliente';
    END IF;
    UPDATE contratos SET is_implicit = false WHERE id = v_contrato_id;
  ELSE
    INSERT INTO contratos (
      tenant_id, cliente_id, tipo, is_implicit,
      data_venda, data_inicio, data_fim, data_proximo_reajuste,
      prazo_meses, dia_vencimento,
      modelo_contrato_id, recorrencia, funcionario_id, origem_venda_id,
      forma_pagamento_ativacao_id, forma_pagamento_mensalidade_id,
      vlr_total_mensal, vlr_total_ativacao,
      observacoes, status
    ) VALUES (
      v_tenant_id, p_cliente_id, 'base', true,
      v_data_venda, v_data_ativacao, (p_dados->>'data_fim')::date, v_data_proximo_reajuste,
      v_prazo_meses, NULLIF((p_dados->>'dia_vencimento')::text, '')::integer,
      NULLIF((p_dados->>'modelo_contrato_id')::text, '')::bigint,
      NULLIF(p_dados->>'recorrencia', '')::recorrencia_tipo,
      NULLIF((p_dados->>'funcionario_id')::text, '')::bigint,
      NULLIF((p_dados->>'origem_venda_id')::text, '')::bigint,
      NULLIF((p_dados->>'forma_pagamento_ativacao_id')::text, '')::bigint,
      NULLIF((p_dados->>'forma_pagamento_mensalidade_id')::text, '')::bigint,
      v_vlr_mensal, v_vlr_ativacao,
      p_dados->>'observacoes_contratuais', 'ativo'
    ) RETURNING id INTO v_contrato_id;
  END IF;

  INSERT INTO contrato_itens (
    contrato_id, cliente_produto_id, descricao, vlr_mensal, vlr_ativacao
  ) VALUES (
    v_contrato_id, v_cliente_produto_id, v_descricao, v_vlr_mensal, v_vlr_ativacao
  );

  UPDATE contratos c
  SET
    vlr_total_mensal = (SELECT COALESCE(SUM(vlr_mensal), 0) FROM contrato_itens WHERE contrato_id = c.id),
    vlr_total_ativacao = (SELECT COALESCE(SUM(vlr_ativacao), 0) FROM contrato_itens WHERE contrato_id = c.id),
    updated_at = now()
  WHERE c.id = v_contrato_id;

  ---------------------------------------------------------- módulos da venda
  IF jsonb_typeof(p_dados->'modulos') = 'array' AND jsonb_array_length(p_dados->'modulos') > 0 THEN
    -- As duas chaves valem até o fim da transação; guarda o valor de antes
    -- para devolver no fim do bloco e não vazar para quem chamou.
    v_prev_fonte := current_setting('doctorsaas.acting_source', true);
    v_prev_hold  := current_setting('doctorsaas.intake_hold_omie', true);
    PERFORM set_config('doctorsaas.acting_source', 'venda_inicial', true);
    PERFORM set_config('doctorsaas.intake_hold_omie', 'true', true);

    v_eh_oem := EXISTS (SELECT 1 FROM public.fn_oem_tabela_do_produto(p_cliente_id, p_produto_id));

    FOR v_mod IN SELECT * FROM jsonb_array_elements(p_dados->'modulos') LOOP
      v_modulo_id := NULLIF(v_mod->>'modulo_id', '')::uuid;
      v_qtd := COALESCE(NULLIF(v_mod->>'quantidade', '')::integer, 1);
      v_mensal_mod := COALESCE(NULLIF(v_mod->>'vlr_mensal', '')::numeric, 0);

      SELECT pm.id, pm.nome, pm.vlr_custo, pm.oem_modulo_codigo INTO v_pm
        FROM produto_modulos pm
       WHERE pm.id = v_modulo_id
         AND pm.produto_id = p_produto_id
         AND pm.tenant_id = v_tenant_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Modulo % nao pertence a este produto', v_mod->>'modulo_id';
      END IF;
      IF v_modulo_id = ANY(v_vistos) THEN
        RAISE EXCEPTION 'Modulo % repetido na venda', v_pm.nome;
      END IF;
      v_vistos := v_vistos || v_modulo_id;
      IF v_qtd < 1 THEN
        RAISE EXCEPTION 'Quantidade do modulo % precisa ser pelo menos 1', v_pm.nome;
      END IF;
      IF v_mensal_mod < 0 THEN
        RAISE EXCEPTION 'Valor mensal do modulo % nao pode ser negativo', v_pm.nome;
      END IF;

      v_tab_id := NULL; v_tab_preco := NULL;
      IF v_eh_oem AND v_pm.oem_modulo_codigo IS NOT NULL THEN
        SELECT t.modulo_id, t.valor_unitario INTO v_tab_id, v_tab_preco
          FROM public.fn_oem_tabela_do_produto(p_cliente_id, p_produto_id) t
         WHERE t.modulo_id = v_modulo_id;
      END IF;

      INSERT INTO cliente_produto_modulos (
        tenant_id, cliente_produto_id, modulo_id, quantidade,
        vlr_mensal, vlr_ativacao, vlr_custo,
        data_ativacao, data_venda, funcionario_id, origem_venda_id,
        oem_modulo_codigo, ativo, origem
      ) VALUES (
        v_tenant_id, v_cliente_produto_id, v_modulo_id, v_qtd,
        v_mensal_mod, 0,
        -- Módulo do parceiro: o custo é o da tabela do OEM, não digitável.
        -- Os demais aceitam o custo da tela, com o do catálogo como reserva.
        CASE WHEN v_tab_id IS NOT NULL THEN COALESCE(v_tab_preco, 0)
             ELSE COALESCE(NULLIF(v_mod->>'vlr_custo', '')::numeric, v_pm.vlr_custo, 0) END,
        v_data_ativacao, v_data_venda,
        NULLIF((p_dados->>'funcionario_id')::text, '')::bigint,
        NULLIF((p_dados->>'origem_venda_id')::text, '')::bigint,
        v_pm.oem_modulo_codigo, true,
        CASE WHEN v_tab_id IS NOT NULL THEN 'oem' ELSE 'manual' END
      );
    END LOOP;

    PERFORM set_config('doctorsaas.acting_source', coalesce(v_prev_fonte, ''), true);
    PERFORM set_config('doctorsaas.intake_hold_omie', coalesce(v_prev_hold, ''), true);
  END IF;

  RETURN v_cliente_produto_id;
END;
$function$;
