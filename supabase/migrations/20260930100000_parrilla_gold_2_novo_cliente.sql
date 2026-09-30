-- PARRILLA GOLD: a venda de 23/09 pela calculadora (CT-2026-7293) é uma SEGUNDA
-- loja no mesmo CNPJ, confirmado pela Digi em 30/09/2026. A calculadora achou o
-- cliente pelo CNPJ e pendurou o contrato na loja 1 (PARRILLA GOLD 1, CT-2026-4495).
--
-- Cria o cliente PARRILLA GOLD 2 com os dados que vieram na proposta e move
-- para ele o que nasceu daquela venda: contrato, produto (módulos e histórico
-- vão junto, pendurados no produto), anexo (pendurado no contrato), jornada de
-- implantação, ticket TK-2026-5234 e o registro da calculadora.
--
-- Fica FORA deste SQL, de propósito, e vai pela tela depois:
--   * vínculo da licença OEM 40561 (Integrações > OEM);
--   * envio ao Omie com "cadastro próprio" (botão Enviar ao Omie do contrato),
--     que cria cadastro novo no Omie sem tocar no da loja 1.
--
-- skip_valor_sync: nada entra na fila do Omie. Mensalidade e custo dos dois
-- clientes são refeitos no fim, com a conta do fn_sync_cliente_mensalidade.
DO $$
DECLARE
  c_tenant  constant uuid := '955178ba-b367-498d-8443-cc5b7d1ee163';
  c_cli1    constant uuid := '9e61f05d-e2c5-4ca3-8f78-3011bad07fd3';  -- PARRILLA GOLD 1
  c_ct_novo constant uuid := 'ee812d29-fc82-44fb-bd6f-92708e7b17db';  -- CT-2026-7293
  c_cp_loja1 constant uuid := 'ca9995bd-3244-4033-916f-dbc7cd81e874'; -- produto do CT-2026-4495
  c_log     constant uuid := '3aec7054-396e-4599-b8f5-dc160ce1b4f6';
  c_journey constant uuid := '21aaa3d0-ee69-48b8-a732-3d916505fddf';
  c_ticket  constant uuid := '31a3f2f7-099e-45c2-b4ca-6c6594893ea9';
  v_cp uuid; v_cli jsonb; v_cli2 uuid; v_cidade bigint; v_estado bigint;
  v_n int; v_res text;
BEGIN
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  ------------------------------------------------------------ travas
  IF NOT EXISTS (SELECT 1 FROM contratos WHERE id = c_ct_novo AND numero = 'CT-2026-7293'
                   AND cliente_id = c_cli1 AND status = 'ativo') THEN
    RAISE EXCEPTION 'ABORTADO: CT-2026-7293 nao esta ativo na PARRILLA GOLD 1';
  END IF;
  SELECT ci.cliente_produto_id INTO v_cp FROM contrato_itens ci WHERE ci.contrato_id = c_ct_novo;
  IF (SELECT count(*) FROM contrato_itens WHERE contrato_id = c_ct_novo) <> 1
  OR (SELECT count(*) FROM contrato_itens WHERE cliente_produto_id = v_cp) <> 1
  OR v_cp = c_cp_loja1 THEN
    RAISE EXCEPTION 'ABORTADO: itens do CT-2026-7293 mudaram';
  END IF;
  IF EXISTS (SELECT 1 FROM cliente_produtos WHERE id = v_cp AND oem_codigo_filial IS NOT NULL) THEN
    RAISE EXCEPTION 'ABORTADO: o produto do CT-2026-7293 ja ganhou licenca OEM';
  END IF;
  IF EXISTS (SELECT 1 FROM movimentos_mrr WHERE contrato_id = c_ct_novo OR encerrado_por_contrato_id = c_ct_novo
                OR cliente_produto_modulo_id IN (SELECT id FROM cliente_produto_modulos WHERE cliente_produto_id = v_cp))
  OR EXISTS (SELECT 1 FROM reajuste_contratos WHERE contrato_id = c_ct_novo)
  OR EXISTS (SELECT 1 FROM oem_sync_fila WHERE cliente_produto_id = v_cp)
  OR EXISTS (SELECT 1 FROM omie_sync_fila WHERE contrato_id = c_ct_novo AND status <> 'invalido')
  OR EXISTS (SELECT 1 FROM reconciliacao_cadastro WHERE ds_contract_id = c_ct_novo AND status_usuario <> 'novo') THEN
    RAISE EXCEPTION 'ABORTADO: CT-2026-7293 ganhou movimento, reajuste, fila ou vinculo com o Omie';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM onboarding_intake_log WHERE id = c_log AND contrato_id = c_ct_novo AND cliente_id = c_cli1)
  OR NOT EXISTS (SELECT 1 FROM onboarding_journeys WHERE id = c_journey AND cliente_id = c_cli1 AND ticket_id = c_ticket)
  OR NOT EXISTS (SELECT 1 FROM support_tickets WHERE id = c_ticket AND cliente_id = c_cli1) THEN
    RAISE EXCEPTION 'ABORTADO: jornada, ticket ou registro da calculadora mudaram';
  END IF;
  IF EXISTS (SELECT 1 FROM clientes WHERE tenant_id = c_tenant AND nome_fantasia ILIKE 'PARRILLA GOLD 2%') THEN
    RAISE EXCEPTION 'ABORTADO: ja existe um cliente PARRILLA GOLD 2';
  END IF;

  ------------------------------------------------ cliente novo (dados da proposta)
  SELECT payload->'cliente' INTO v_cli FROM onboarding_intake_log WHERE id = c_log;
  SELECT c.id, c.estado_id INTO v_cidade, v_estado
    FROM cidades c JOIN estados e ON e.id = c.estado_id
   WHERE extensions.unaccent(lower(c.nome)) = extensions.unaccent(lower(btrim(v_cli->>'cidade')))
     AND upper(e.sigla) = upper(coalesce(v_cli->>'uf','')) LIMIT 1;

  INSERT INTO clientes (
    tenant_id, cnpj, razao_social, nome_fantasia, email, contato_nome,
    telefone_contato, telefone_whatsapp, segmento_id, unidade_base_id,
    endereco, numero, bairro, complemento, cep, cidade_id, estado_id, cancelado,
    data_cadastro, contato_fone, observacao_cliente, area_atuacao_id)
  SELECT
    c_tenant, regexp_replace(v_cli->>'cnpj','\D','','g'),
    c1.razao_social,                       -- a proposta veio sem razao; e a mesma empresa
    'PARRILLA GOLD 2',                     -- nome da licenca no OEM (filial 40561)
    nullif(btrim(v_cli->>'email'),''),
    nullif(btrim(v_cli->>'contato_nome'),''),
    nullif(regexp_replace(coalesce(v_cli->>'telefone',''),'\D','','g'),''),
    nullif(regexp_replace(coalesce(v_cli->>'telefone',''),'\D','','g'),''),
    nullif(v_cli->>'segmento_id','')::bigint, c1.unidade_base_id,
    nullif(btrim(v_cli->>'endereco'),''), nullif(btrim(v_cli->>'numero'),''),
    nullif(btrim(v_cli->>'bairro'),''), nullif(btrim(v_cli->>'complemento'),''),
    nullif(regexp_replace(coalesce(v_cli->>'cep',''),'\D','','g'),''),
    v_cidade, v_estado, false,
    nullif(v_cli->>'data_cadastro','')::date,
    nullif(regexp_replace(coalesce(v_cli->>'contato_fone',''),'\D','','g'),''),
    nullif(btrim(v_cli->>'observacao_cliente'),''),
    nullif(v_cli->>'area_atuacao_id','')::bigint
  FROM clientes c1 WHERE c1.id = c_cli1
  RETURNING id INTO v_cli2;

  ------------------------------------------------ muda de dono
  UPDATE contratos        SET cliente_id = v_cli2, updated_at = now() WHERE id = c_ct_novo;
  UPDATE cliente_produtos SET cliente_id = v_cli2, updated_at = now() WHERE id = v_cp;
  UPDATE onboarding_journeys SET cliente_id = v_cli2 WHERE id = c_journey;
  UPDATE support_tickets     SET cliente_id = v_cli2 WHERE id = c_ticket;
  UPDATE onboarding_intake_log SET cliente_id = v_cli2, cliente_reusado = false WHERE id = c_log;

  -- Linha da Conferencia Omie nasceu com o cliente errado e nunca foi decidida;
  -- a proxima geracao recria com o cliente certo. Fila: so tentativas recusadas
  -- por "multiplos contratos ativos".
  DELETE FROM reconciliacao_cadastro WHERE ds_contract_id = c_ct_novo;
  DELETE FROM omie_sync_fila WHERE contrato_id = c_ct_novo AND status = 'invalido';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE clientes c
     SET mensalidade    = coalesce((SELECT sum(coalesce(cp.vlr_mensal,0)) FROM cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.ativo), 0),
         custo_operacao = coalesce((SELECT sum(coalesce(cp.vlr_custo,0))  FROM cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.ativo), 0),
         updated_at     = now()
   WHERE c.id IN (c_cli1, v_cli2);

  SELECT string_agg(format(E'\n%s | %s | cidade %s | mensalidade %s | custo %s | contratos: %s',
           c.nome_fantasia, c.id, coalesce(v_cidade::text,'NAO ACHOU'), c.mensalidade, c.custo_operacao,
           (SELECT string_agg(k.numero || ' ' || k.status, ', ') FROM contratos k WHERE k.cliente_id = c.id)), '' ORDER BY c.nome_fantasia)
    INTO v_res FROM clientes c WHERE c.id IN (c_cli1, v_cli2);

  RAISE NOTICE 'PARRILLA_OK% | fila Omie -%', v_res, v_n;
END $$;
