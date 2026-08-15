-- 14/08/2026 - Telefone do cliente passa a viajar para o Omie, com o 9 do celular.
--
-- ACHADO QUE ORIGINOU ISTO: o DoctorSaaS NUNCA enviou telefone ao Omie. Nao enviava errado --
-- nao enviava. O `montar_payload_contrato_omie` monta cnpj/razao/fantasia/email/contato/endereco
-- e para por ai; o `ds-omie-cliente-upsert` (DoctorOMIE) tem 'telefone1_ddd'/'telefone1_numero'
-- na lista CAMPOS desde a v9 e esses campos SEMPRE chegaram vazios. Por isso o cadastro do Omie
-- fica com o telefone que veio da origem (PLG/importacao), inclusive celular de 8 digitos sem o 9
-- (caso Ofinas Burgues: DDD 94 / 92140639, que deveria ser 992140639).
--
-- 1) fn_fone_omie(text): parte um telefone BR livre em {ddd, numero} e completa o 9 do celular.
--    Celular de 8 digitos comecando em 6-9 e numeracao pre-2016; o 9 na frente e o mapeamento
--    oficial da Anatel, nao chute. Fixo comeca em 2-5 e sai intocado.
--    Qualquer coisa que nao vire (10|11) digitos plausiveis retorna NULL -> nada e enviado.
--    Melhor nao mandar do que mandar lixo: o upsert nunca apaga campo que nao recebe.
--
-- 2) montar_payload_contrato_omie: acrescenta telefone1_ddd/telefone1_numero ao bloco `cliente`.
--    Fonte: clientes.telefone_whatsapp (obrigatorio no cadastro, validado como celular na tela),
--    com fallback para clientes.telefone_contato. Decisao do Alexandre em 14/08/2026.
--    O resto do corpo e IDENTICO ao de producao (extraido do banco, nao das migrations).
--    jsonb_strip_nulls ja existia: cliente sem telefone => payload igual ao de antes.

CREATE OR REPLACE FUNCTION public.fn_fone_omie(p_raw text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $fn$
  WITH d AS (
    -- zero a esquerda ('0' de DDD antigo, '00' de discagem internacional) nao e digito de numero
    SELECT regexp_replace(regexp_replace(COALESCE(p_raw, ''), '\D', '', 'g'), '^0+', '') AS dig
  ), sem55 AS (
    -- tira o codigo do pais so quando sobra um telefone BR plausivel
    SELECT CASE
             WHEN dig LIKE '55%' AND length(dig) IN (12, 13) THEN substr(dig, 3)
             ELSE dig
           END AS dig
    FROM d
  ), partes AS (
    SELECT substr(dig, 1, 2) AS ddd,
           substr(dig, 3)    AS num
    FROM sem55
    WHERE length(dig) IN (10, 11)
  )
  SELECT jsonb_build_object(
           'ddd', ddd,
           'numero', CASE
                       -- celular pre-2016: 8 digitos comecando em 6-9 -> ganha o 9
                       WHEN length(num) = 8 AND substr(num, 1, 1) ~ '[6-9]' THEN '9' || num
                       ELSE num
                     END
         )
  FROM partes
  WHERE ddd::int BETWEEN 11 AND 99
    AND (
      -- celular ja com 9 digitos tem que comecar em 9; fixo tem 8 e comeca em 2-5
      (length(num) = 9 AND substr(num, 1, 1) = '9')
      OR (length(num) = 8 AND substr(num, 1, 1) ~ '[2-9]')
    );
$fn$;

ALTER FUNCTION public.fn_fone_omie(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_fone_omie(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_fone_omie(text) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION "public"."montar_payload_contrato_omie"("p_contrato_id" "uuid", "p_tenant_id" "uuid", "p_incluir_situacao" boolean DEFAULT false, "p_incluir_observacao" boolean DEFAULT false, "p_incluir_vigencia" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_contrato   record;
  v_cliente    record;
  v_modelo     record;
  v_qtd_itens  integer;
  v_item       record;
  v_cidade_prestacao text;
  v_erros      text[] := '{}';
  v_cliente_json jsonb;
  v_contrato_json jsonb;
  v_qtd_contratos_ativos integer;
  v_valor_mrr  numeric;
  v_fone       jsonb;
BEGIN
  PERFORM public.assert_tenant_scope(p_tenant_id);
  SELECT * INTO v_contrato FROM contratos
  WHERE id = p_contrato_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erros', jsonb_build_array('Contrato nao encontrado ou nao pertence a este tenant.'));
  END IF;

  SELECT * INTO v_cliente FROM clientes
  WHERE id = v_contrato.cliente_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erros', jsonb_build_array('Cliente do contrato nao encontrado.'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM omie_integration oi
    WHERE oi.tenant_id = p_tenant_id
      AND (oi.unidades_base_ids IS NULL
           OR (v_cliente.unidade_base_id IS NOT NULL
               AND v_cliente.unidade_base_id = ANY(oi.unidades_base_ids)))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'erros', jsonb_build_array(
      'Cliente fora do escopo da integracao Omie (unidade base ' ||
      coalesce(v_cliente.unidade_base_id::text, 'nao definida') ||
      '). Esta integracao cobre apenas as unidades configuradas.'
    ));
  END IF;

  -- 17/07/2026 (portao 3): MODELO MARCADO PARA NAO SINCRONIZAR.
  SELECT mc.nome, mc.sincroniza_omie INTO v_modelo
  FROM modelos_contrato mc WHERE mc.id = v_contrato.modelo_contrato_id;

  IF v_contrato.modelo_contrato_id IS NOT NULL AND v_modelo.sincroniza_omie IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'bloqueado', 'modelo_fora_do_escopo',
      'erros', jsonb_build_array(
        'Contrato usa o modelo "' || COALESCE(v_modelo.nome, '?') ||
        '", marcado para NAO sincronizar com o Omie. Nenhuma alteracao deste contrato e enviada ' ||
        '-- nem cadastro, nem valor, nem cancelamento. Para mudar isso, desmarque a opcao no modelo.'
      ));
  END IF;

  IF v_contrato.status = 'cancelado' THEN
    RETURN jsonb_build_object(
      'ok', true, 'operacao', 'cancelar',
      'contrato', jsonb_build_object(
        'ds_contract_id', v_contrato.id::text,
        'situacao',       '99',
        'vigencia_final', COALESCE(v_contrato.cancelado_em, CURRENT_DATE)
      )
    );
  END IF;

  SELECT count(*) INTO v_qtd_itens FROM contrato_itens WHERE contrato_id = p_contrato_id;
  IF v_qtd_itens = 0 THEN
    v_erros := array_append(v_erros, 'Contrato sem produto vinculado (nenhum item). Vincule um produto antes de enviar ao Omie.');
  ELSIF v_qtd_itens > 1 THEN
    v_erros := array_append(v_erros, 'Contrato com multiplos produtos ainda nao e suportado na integracao (contem ' || v_qtd_itens || ' itens).');
  END IF;

  IF v_cliente.cnpj IS NULL OR btrim(v_cliente.cnpj) = '' THEN
    v_erros := array_append(v_erros, 'Cliente sem CNPJ/CPF cadastrado.');
  END IF;
  IF v_cliente.razao_social IS NULL OR btrim(v_cliente.razao_social) = '' THEN
    v_erros := array_append(v_erros, 'Cliente sem razao social cadastrada.');
  END IF;
  IF v_contrato.modelo_contrato_id IS NULL THEN
    v_erros := array_append(v_erros, 'Contrato sem modelo de contrato definido. Defina o modelo antes de enviar ao Omie.');
  END IF;
  IF v_contrato.data_venda IS NULL THEN
    v_erros := array_append(v_erros, 'Contrato sem Data da Venda (vigencia inicial). Preencha antes de enviar ao Omie.');
  END IF;
  IF v_contrato.data_proximo_reajuste IS NULL THEN
    v_erros := array_append(v_erros, 'Contrato sem Data do Proximo Reajuste (vigencia final). Preencha antes de enviar ao Omie.');
  END IF;

  IF p_incluir_vigencia
     AND v_contrato.data_proximo_reajuste IS NOT NULL
     AND v_contrato.data_proximo_reajuste < CURRENT_DATE THEN
    v_erros := array_append(v_erros,
      'Data do Proximo Reajuste esta vencida (' ||
      to_char(v_contrato.data_proximo_reajuste, 'DD/MM/YYYY') ||
      '). Enviar assim gravaria vigencia final no passado no Omie e o contrato pararia de ' ||
      'faturar. Aplique o reajuste (ou corrija a data) antes de sincronizar.');
  END IF;

  SELECT count(*) INTO v_qtd_contratos_ativos
  FROM contratos WHERE cliente_id = v_cliente.id AND tenant_id = p_tenant_id AND status = 'ativo';
  IF v_qtd_contratos_ativos > 1 THEN
    v_erros := array_append(v_erros, 'Cliente com multiplos contratos ativos (' || v_qtd_contratos_ativos || ') ainda nao e suportado na sincronizacao automatica de valor. Ajuste o valor manualmente no Omie.');
  END IF;

  IF array_length(v_erros, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'erros', to_jsonb(v_erros));
  END IF;

  -- 03/08/2026: entra `pr.omie_servico_codigo`. LEFT JOIN de proposito -- produto sem linha em
  -- `produtos` nao pode derrubar um envio que ate ontem funcionava.
  SELECT cp.produto_id, cp.vlr_mensal, pr.omie_servico_codigo INTO v_item
  FROM contrato_itens ci
  JOIN cliente_produtos cp ON cp.id = ci.cliente_produto_id
  LEFT JOIN produtos pr ON pr.id = cp.produto_id
  WHERE ci.contrato_id = p_contrato_id LIMIT 1;

  SELECT UPPER(cid.nome) || ' (' || est.sigla || ')' INTO v_cidade_prestacao
  FROM cidades cid JOIN estados est ON est.id = cid.estado_id
  WHERE cid.id = v_cliente.cidade_id;

  v_valor_mrr := public.calcular_mrr_cliente(v_cliente.id, p_tenant_id);

  -- WhatsApp Financeiro e o campo obrigatorio do cadastro e o unico garantidamente celular;
  -- Telefone Contato so entra quando ele esta vazio.
  v_fone := public.fn_fone_omie(
    COALESCE(NULLIF(btrim(v_cliente.telefone_whatsapp), ''), v_cliente.telefone_contato)
  );

  v_cliente_json := jsonb_strip_nulls(jsonb_build_object(
    'ds_customer_id', v_cliente.id::text,
    'cnpj_cpf',       v_cliente.cnpj,
    'razao_social',   v_cliente.razao_social,
    'nome_fantasia',  v_cliente.nome_fantasia,
    'email',          v_cliente.email,
    'contato',        v_cliente.contato_nome,
    'telefone1_ddd',    v_fone->>'ddd',
    'telefone1_numero', v_fone->>'numero',
    'endereco',       v_cliente.endereco,
    'endereco_numero',v_cliente.numero,
    'bairro',         v_cliente.bairro,
    'complemento',    v_cliente.complemento,
    'cep',            v_cliente.cep,
    'cidade',         (SELECT nome FROM cidades WHERE id = v_cliente.cidade_id),
    'estado',         (SELECT est.sigla FROM cidades cid JOIN estados est ON est.id = cid.estado_id WHERE cid.id = v_cliente.cidade_id)
  ));

  v_contrato_json := jsonb_strip_nulls(jsonb_build_object(
    'ds_contract_id',    v_contrato.id::text,
    'numero',            v_contrato.numero,
    'ds_customer_id',    v_cliente.id::text,
    'ds_produto_id',     v_item.produto_id::text,
    'ds_funcionario_id', v_contrato.funcionario_id::text,
    'valor_mensal',      v_valor_mrr,
    'dia_vencimento',    v_contrato.dia_vencimento,
    'vigencia_inicial',  v_contrato.data_venda,
    'vigencia_final',    CASE WHEN p_incluir_vigencia THEN v_contrato.data_proximo_reajuste ELSE NULL END,
    'cidade_prestacao',  v_cidade_prestacao,
    'contato',           v_cliente.contato_nome,
    'modelo_contrato',   (SELECT nome FROM modelos_contrato WHERE id = v_contrato.modelo_contrato_id),
    'situacao',          CASE WHEN p_incluir_situacao THEN '10' ELSE NULL END,
    'observacao',        CASE WHEN p_incluir_observacao THEN COALESCE(v_cliente.observacao_cliente, '') ELSE NULL END,
    -- NULL some no jsonb_strip_nulls => payload identico ao anterior para quem nao preencheu.
    'omie_servico_codigo', v_item.omie_servico_codigo
  ));

  RETURN jsonb_build_object('ok', true, 'cliente', v_cliente_json, 'contrato', v_contrato_json);
END;
$$;


