-- DEM-0237 — parte C (lado DS): o payload passa a levar o SERVIÇO OMIE do produto.
--
-- POR QUE
--   `produtos.omie_servico_codigo` existe, é editável em Configurações → Produtos e no cadastro
--   do produto do cliente — e NUNCA saía do DoctorSaaS. O montar_payload_contrato_omie não o
--   incluía, então o ds-omie-contrato-criar sempre caía no fallback `padroes.servico_omie_codigo`
--   (o serviço padrão do tenant). Resultado: o campo que o usuário preenche não tinha efeito
--   nenhum, e todo contrato nasceu no Omie com o serviço padrão.
--   Sem este campo no payload, a v13 do ds-omie-contrato-alterar não tem como corrigir o serviço
--   quando o produto do contrato muda — só a categoria.
--
-- SEGURANÇA DO ROLLOUT
--   jsonb_strip_nulls (já aplicado no v_contrato_json) REMOVE a chave quando o produto não tem
--   serviço definido. Para esses — que hoje são todos, na prática — o payload sai idêntico ao de
--   antes e o comportamento não muda em nada. Só passa a viajar onde alguém preencheu de fato.
--   Do outro lado, o alterar só troca o serviço se o espelho `omie_servicos` confirmar o cadastro;
--   senão preserva o do Omie e devolve aviso. Nunca grava LC116 nulo.

BEGIN;

CREATE OR REPLACE FUNCTION public.montar_payload_contrato_omie(
  p_contrato_id uuid,
  p_tenant_id uuid,
  p_incluir_situacao boolean DEFAULT false,
  p_incluir_observacao boolean DEFAULT false,
  p_incluir_vigencia boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  v_cliente_json := jsonb_strip_nulls(jsonb_build_object(
    'ds_customer_id', v_cliente.id::text,
    'cnpj_cpf',       v_cliente.cnpj,
    'razao_social',   v_cliente.razao_social,
    'nome_fantasia',  v_cliente.nome_fantasia,
    'email',          v_cliente.email,
    'contato',        v_cliente.contato_nome,
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
$function$;

COMMIT;
