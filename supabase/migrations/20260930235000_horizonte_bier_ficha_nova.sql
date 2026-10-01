-- HORIZONTE BIER (Digi Office, CNPJ 43.383.071/0001-23): cliente desde 02/2024,
-- cancelado em 13/05/2026, voltou pela calculadora em 22/09/2026 (CT-2026-7291).
-- A calculadora achou a ficha pelo CNPJ e pendurou o contrato novo nela, entao
-- o Dashboard via a venda como de 02/2024 (data_venda_efetiva = 1a venda da ficha).
--
-- Decisao do Alexandre (30/09/2026): caso atipico, a venda de 22/09 tem que
-- aparecer em Vendas > Novos Clientes de setembro. Mesmo desenho da PARRILLA
-- GOLD 2: ficha nova recebe tudo o que nasceu a partir de 22/09; a antiga fica
-- como era (cliente de 2024, cancelado em 13/05, contrato e titulos antigos).
--
-- Desfaz a reativacao gravada mais cedo no mesmo dia (movimento + evento),
-- senao o cliente contaria como novo E como reativado.
--
-- Nada vai para o Omie: contrato e produto mudam so de cliente_id (os gatilhos
-- do Omie olham status/valor). O vinculo Omie do contrato (reconciliacao_cadastro)
-- passa para a ficha nova, e o casamento de titulos so preenche titulo sem
-- cliente, entao os titulos antigos ficam onde estao.
--
-- v_smoke = true: faz tudo e desfaz no fim, devolvendo o resumo no erro.
DO $$
DECLARE
  v_smoke   constant boolean := false;
  c_tenant  constant uuid := '955178ba-b367-498d-8443-cc5b7d1ee163';
  c_cli1    constant uuid := '88980316-48fd-42a7-984b-eb46f925338d';  -- ficha antiga
  c_ct_novo constant uuid := '012edd25-c453-4667-b003-21a525addcb2';  -- CT-2026-7291
  c_ct_velho constant uuid := 'c652c29f-8bfb-4390-96b0-8a4e2897a809'; -- CT-2026-1602
  c_cp_novo constant uuid := '372980c7-fa84-432c-99f8-f992cb00326e';
  c_log     constant uuid := '20ff8280-f487-4a64-a502-975931c65e3a';
  c_journey constant uuid := 'dbfb4b94-51cb-47b7-8904-972ae626bd65';
  c_tickets constant uuid[] := array['e3f5e1c6-84fd-4851-a198-2fedbb21febf',
                                     'c4626cd6-b28e-4462-af1b-a2cace228edc',
                                     'c367df7a-e43d-4fc6-bbf3-4832485d50f8']::uuid[];
  c_contacts constant uuid[] := array['c8ea38dc-d809-4851-96ec-34a3d3ff4cc2',
                                      'fbe8022d-041c-45f6-b6c7-f4a7b52d096c']::uuid[];
  c_mov_reat constant uuid := '109bec46-107b-403e-984d-6e30cd0dc1ec';
  c_evt_reat constant uuid := 'b762b1ea-38ae-43d5-8ccc-d6376b210ae9';
  c_titulo_novo constant uuid := '1546fd9f-3c01-40b7-a75f-77ce5102fc5f'; -- R$ 1,00 de 24/09
  c_autor   constant uuid := '7743d108-318d-4baf-8ccd-eb4fefef320f';
  v_cli2 uuid; v_obs text; v_net0 bigint; v_net1 bigint; v_n int; v_res text;
BEGIN
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);
  -- 2 dos 3 tickets estao finalizados e trg_protect_terminal_ticket so deixa
  -- admin/head/super admin mexer. Roda identificado como o super admin do
  -- Alexandre (quem autorizou), que e o que a trava pede.
  PERFORM set_config('request.jwt.claim.sub', c_autor::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', c_autor, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM c_autor OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'ABORTADO: nao consegui rodar identificado como o super admin';
  END IF;
  SELECT count(*) INTO v_net0 FROM net.http_request_queue;

  ------------------------------------------------------------ travas
  IF NOT EXISTS (SELECT 1 FROM contratos WHERE id = c_ct_novo AND cliente_id = c_cli1 AND status = 'ativo') THEN
    RAISE EXCEPTION 'ABORTADO: CT-2026-7291 nao esta ativo na ficha antiga';
  END IF;
  IF (SELECT count(*) FROM contrato_itens WHERE contrato_id = c_ct_novo) <> 1
  OR NOT EXISTS (SELECT 1 FROM contrato_itens WHERE contrato_id = c_ct_novo AND cliente_produto_id = c_cp_novo)
  OR (SELECT count(*) FROM contrato_itens WHERE cliente_produto_id = c_cp_novo) <> 1 THEN
    RAISE EXCEPTION 'ABORTADO: itens do CT-2026-7291 mudaram';
  END IF;
  IF (SELECT count(*) FROM contratos WHERE cliente_id = c_cli1) <> 2
  OR (SELECT count(*) FROM cliente_produtos WHERE cliente_id = c_cli1) <> 2
  OR (SELECT count(*) FROM support_attendances WHERE cliente_id = c_cli1) <> 5
  OR (SELECT count(*) FROM support_attendances WHERE cliente_id = c_cli1 AND status <> 'closed') <> 0
  OR (SELECT count(*) FROM support_tickets WHERE cliente_id = c_cli1) <> 3
  OR (SELECT count(*) FROM movimentos_mrr WHERE cliente_id = c_cli1) <> 2
  OR (SELECT count(*) FROM fin_titulos WHERE cliente_id = c_cli1) <> 12 THEN
    RAISE EXCEPTION 'ABORTADO: a ficha ganhou registro novo desde o levantamento';
  END IF;
  IF EXISTS (SELECT 1 FROM clientes WHERE tenant_id = c_tenant AND cnpj_digits = '43383071000123' AND id <> c_cli1) THEN
    RAISE EXCEPTION 'ABORTADO: ja existe outra ficha com este CNPJ';
  END IF;

  ------------------------------------------------ desfaz a reativacao de hoje
  DELETE FROM contrato_eventos WHERE id = c_evt_reat AND acao = 'reativacao';
  DELETE FROM movimentos_mrr  WHERE id = c_mov_reat AND tipo = 'reactivation';

  ------------------------------------------------ ficha nova (copia da antiga)
  SELECT nullif(btrim(payload->'cliente'->>'observacao_cliente'), '') INTO v_obs
    FROM onboarding_intake_log WHERE id = c_log;

  INSERT INTO clientes (
    tenant_id, data_cadastro, razao_social, nome_fantasia, cnpj, email,
    telefone_contato, telefone_whatsapp, telefone_whatsapp_contato, observacao_cliente,
    estado_id, cidade_id, area_atuacao_id, segmento_id, unidade_base_id,
    cep, endereco, numero, bairro, complemento,
    contato_nome, contato_cpf, contato_fone, contato_aniversario,
    imposto_percentual, custo_fixo_percentual,
    data_ativacao, dia_vencimento_mrr, data_reajuste, setup_completo,
    cancelado, mensalidade, custo_operacao)
  SELECT
    tenant_id, date '2026-09-22', razao_social, nome_fantasia, cnpj, email,
    telefone_contato, telefone_whatsapp, telefone_whatsapp_contato, coalesce(v_obs, observacao_cliente),
    estado_id, cidade_id, area_atuacao_id, segmento_id, unidade_base_id,
    cep, endereco, numero, bairro, complemento,
    contato_nome, contato_cpf, contato_fone, contato_aniversario,
    imposto_percentual, custo_fixo_percentual,
    date '2026-09-22', dia_vencimento_mrr, date '2027-10-01', setup_completo,
    false, 0, 0
  FROM clientes WHERE id = c_cli1
  RETURNING id INTO v_cli2;

  ------------------------------------------------ muda de dono o que nasceu em 22/09+
  UPDATE contratos        SET cliente_id = v_cli2, updated_at = now() WHERE id = c_ct_novo;
  UPDATE cliente_produtos SET cliente_id = v_cli2, updated_at = now() WHERE id = c_cp_novo;
  UPDATE contrato_eventos SET cliente_id = v_cli2 WHERE contrato_id = c_ct_novo;
  UPDATE onboarding_journeys   SET cliente_id = v_cli2 WHERE id = c_journey AND cliente_id = c_cli1;
  UPDATE onboarding_intake_log SET cliente_id = v_cli2, cliente_reusado = false WHERE id = c_log;
  UPDATE support_tickets       SET cliente_id = v_cli2 WHERE id = ANY(c_tickets) AND cliente_id = c_cli1;
  UPDATE support_attendances   SET cliente_id = v_cli2, updated_at = now() WHERE cliente_id = c_cli1;
  UPDATE whatsapp_contacts     SET cliente_id = v_cli2 WHERE id = ANY(c_contacts) AND cliente_id IS NOT DISTINCT FROM c_cli1;
  UPDATE cliente_contatos      SET cliente_id = v_cli2 WHERE cliente_id = c_cli1;
  UPDATE whatsapp_conversations
     SET metadata = metadata || jsonb_build_object('cliente_id', v_cli2::text)
   WHERE contact_id = ANY(c_contacts) AND metadata->>'cliente_id' = c_cli1::text;
  UPDATE fin_titulos SET cliente_id = v_cli2 WHERE id = c_titulo_novo AND cliente_id = c_cli1;
  UPDATE reconciliacao_cadastro SET ds_customer_id = v_cli2 WHERE ds_contract_id = c_ct_novo;
  UPDATE reconciliacao_oem      SET ds_customer_id = v_cli2 WHERE ds_customer_id = c_cli1;

  ------------------------------------------------ estado das duas fichas
  -- Antiga volta a ser o que era antes de 22/09: cancelada em 13/05, mensalidade
  -- preservada para historico (nunca zerar no cancelamento).
  UPDATE clientes SET cancelado = true, data_cancelamento = date '2026-05-13',
         mensalidade = 478.20, custo_operacao = 159.38, updated_at = now()
   WHERE id = c_cli1;
  UPDATE clientes c
     SET mensalidade    = coalesce((SELECT sum(coalesce(cp.vlr_mensal,0)) FROM cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.ativo), 0),
         custo_operacao = coalesce((SELECT sum(coalesce(cp.vlr_custo,0))  FROM cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.ativo), 0),
         updated_at     = now()
   WHERE c.id = v_cli2;

  SELECT count(*) INTO v_net1 FROM net.http_request_queue;

  SELECT string_agg(format(E'\n%s #%s | %s | cancelado %s em %s | venda efetiva %s | mensalidade %s | mrr %s | contratos %s | att %s | tk %s | wc %s | titulos %s | movs %s',
           c.nome_fantasia, c.codigo_sequencial, c.id, c.cancelado, coalesce(c.data_cancelamento::text,'-'),
           v.data_venda_efetiva, c.mensalidade, public.fn_mrr_cliente_em(c.tenant_id, c.id, date '2026-09-30'),
           (SELECT string_agg(k.numero || ' ' || k.status, ', ') FROM contratos k WHERE k.cliente_id = c.id),
           (SELECT count(*) FROM support_attendances a WHERE a.cliente_id = c.id),
           (SELECT count(*) FROM support_tickets t WHERE t.cliente_id = c.id),
           (SELECT count(*) FROM whatsapp_contacts w WHERE w.cliente_id = c.id),
           (SELECT count(*) FROM fin_titulos f WHERE f.cliente_id = c.id),
           (SELECT string_agg(m.tipo::text, ',') FROM movimentos_mrr m WHERE m.cliente_id = c.id)),
         '' ORDER BY c.created_at)
    INTO v_res
    FROM clientes c JOIN vw_clientes_financeiro v ON v.id = c.id
   WHERE c.id IN (c_cli1, v_cli2);

  v_res := v_res || format(E'\nconversas: %s | http_queue %s -> %s',
    (SELECT string_agg(w.status || '/' || coalesce(w.department_id::text,'SEM SETOR') || '/' || coalesce(w.unidade_base_id::text,'-'), ', ')
       FROM whatsapp_conversations w WHERE w.contact_id = ANY(c_contacts)),
    v_net0, v_net1);

  IF v_smoke THEN
    RAISE EXCEPTION 'SMOKE_OK|%', v_res;
  END IF;
  RAISE NOTICE 'HORIZONTE_OK%', v_res;
END $$;
