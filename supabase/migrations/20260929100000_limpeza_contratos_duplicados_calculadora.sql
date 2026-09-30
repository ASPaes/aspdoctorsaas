-- Limpeza dos contratos que a calculadora duplicou (antes da correção de
-- 20260928160000). Aprovada pelo usuário em 29/09/2026 para 2 clientes da Digi;
-- a PARRILLA GOLD (CT-2026-4495 × CT-2026-7293) ficou de fora de propósito.
--
-- Fica o contrato ANTIGO: é ele que está vinculado ao Omie e tem a data de venda
-- e o vencimento certos. O da calculadora tinha os módulos e o anexo, que passam
-- para o antigo antes de ele ser apagado.
--
-- skip_valor_sync: nada vai para a fila do Omie e nenhum gatilho recalcula
-- valor. O custo do produto e a mensalidade do cliente são refeitos à mão no
-- fim, com a mesma conta dos gatilhos.
--
-- As travas abortam TUDO se o banco não estiver como foi medido em 29/09.
DO $$
DECLARE
  r record;
  v_mods int; v_ev int; v_anx int; v_log int; v_fila int; v_rec int;
  v_res text := '';
BEGIN
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  FOR r IN SELECT * FROM (VALUES
    ('DEGUST CLUB',  'CT-2026-5991', 'CT-2026-7039',
     '304ed14f-8963-44ac-9ed9-649cf91d8ef8'::uuid, '0d8ad1fe-3685-4a7b-a1de-bb5a9dc9dd56'::uuid,
     '72a0adab-fb35-4ef8-b60d-1de53fb326a8'::uuid, 'a2755045-1d02-4299-8b8b-61663ef2fcf7'::uuid,
     'a3c8c5e6-5c4a-420b-a065-7c57aa1f5aae'::uuid),
    ('MEXERICA LAB', 'CT-2026-5990', 'CT-2026-7295',
     '20bb34fe-2aed-46e9-962a-88e475c4a7e7'::uuid, '467ab9e4-2776-4037-9f82-79caf74cf048'::uuid,
     'c6830bf2-d89b-4731-9b16-4549fe68c71b'::uuid, 'ccf2abee-7584-49cb-884d-7caa36b2e976'::uuid,
     'c1327183-a4fa-4842-9a75-1ad4a432445a'::uuid)
  ) v(cliente, velho, novo, kv, kn, cpv, cpn, cli) LOOP

    ------------------------------------------------------------ travas
    IF NOT EXISTS (SELECT 1 FROM contratos WHERE id = r.kv AND numero = r.velho AND cliente_id = r.cli AND status = 'ativo')
    OR NOT EXISTS (SELECT 1 FROM contratos WHERE id = r.kn AND numero = r.novo  AND cliente_id = r.cli AND status = 'ativo') THEN
      RAISE EXCEPTION 'ABORTADO %: contrato % ou % nao esta ativo neste cliente', r.cliente, r.velho, r.novo;
    END IF;
    IF (SELECT count(*) FROM contrato_itens WHERE contrato_id = r.kn) <> 1
    OR (SELECT count(*) FROM contrato_itens WHERE cliente_produto_id = r.cpn) <> 1
    OR NOT EXISTS (SELECT 1 FROM contrato_itens WHERE contrato_id = r.kn AND cliente_produto_id = r.cpn)
    OR NOT EXISTS (SELECT 1 FROM contrato_itens WHERE contrato_id = r.kv AND cliente_produto_id = r.cpv) THEN
      RAISE EXCEPTION 'ABORTADO %: itens dos contratos mudaram', r.cliente;
    END IF;
    IF EXISTS (SELECT 1 FROM cliente_produto_modulos WHERE cliente_produto_id = r.cpv) THEN
      RAISE EXCEPTION 'ABORTADO %: o contrato % ja ganhou modulos', r.cliente, r.velho;
    END IF;
    IF EXISTS (SELECT 1 FROM contrato_anexos WHERE contrato_id = r.kv) THEN
      RAISE EXCEPTION 'ABORTADO %: o contrato % ja ganhou anexo', r.cliente, r.velho;
    END IF;
    IF EXISTS (SELECT 1 FROM movimentos_mrr WHERE contrato_id = r.kn OR encerrado_por_contrato_id = r.kn)
    OR EXISTS (SELECT 1 FROM contrato_eventos WHERE contrato_id = r.kn)
    OR EXISTS (SELECT 1 FROM reajuste_contratos WHERE contrato_id = r.kn)
    OR EXISTS (SELECT 1 FROM contratos WHERE contrato_pai_id = r.kn)
    OR EXISTS (SELECT 1 FROM oem_sync_fila WHERE cliente_produto_id = r.cpn) THEN
      RAISE EXCEPTION 'ABORTADO %: o contrato % ganhou movimento, evento, reajuste ou fila do OEM', r.cliente, r.novo;
    END IF;

    ------------------------------------------------ passa para o antigo
    UPDATE cliente_produto_modulos SET cliente_produto_id = r.cpv, updated_at = now()
     WHERE cliente_produto_id = r.cpn;
    GET DIAGNOSTICS v_mods = ROW_COUNT;

    UPDATE cliente_produto_modulo_eventos SET cliente_produto_id = r.cpv
     WHERE cliente_produto_id = r.cpn;
    GET DIAGNOSTICS v_ev = ROW_COUNT;

    UPDATE contrato_anexos SET contrato_id = r.kv, updated_at = now()
     WHERE contrato_id = r.kn;
    GET DIAGNOSTICS v_anx = ROW_COUNT;

    UPDATE onboarding_intake_log SET contrato_id = r.kv
     WHERE contrato_id = r.kn;
    GET DIAGNOSTICS v_log = ROW_COUNT;

    -- Custo do produto = soma dos módulos, a mesma conta do fn_sync_produto_valores.
    UPDATE cliente_produtos cp
       SET vlr_custo = s.custo, updated_at = now()
      FROM (SELECT sum(coalesce(m.vlr_custo_total, coalesce(m.vlr_custo,0) * m.quantidade)) custo
              FROM cliente_produto_modulos m
             WHERE m.cliente_produto_id = r.cpv AND m.ativo) s
     WHERE cp.id = r.cpv AND s.custo IS NOT NULL;

    ------------------------------------------------ apaga o da calculadora
    DELETE FROM omie_sync_fila WHERE contrato_id = r.kn;              -- só tentativas recusadas
    GET DIAGNOSTICS v_fila = ROW_COUNT;
    DELETE FROM reconciliacao_cadastro WHERE ds_contract_id = r.kn;   -- linha "novo", nunca vinculada
    GET DIAGNOSTICS v_rec = ROW_COUNT;
    DELETE FROM contrato_itens WHERE contrato_id = r.kn;
    DELETE FROM cliente_produtos WHERE id = r.cpn;
    DELETE FROM contratos WHERE id = r.kn;

    -- Mensalidade e custo do cliente, a mesma conta do fn_sync_cliente_mensalidade.
    UPDATE clientes c
       SET mensalidade    = coalesce((SELECT sum(coalesce(cp.vlr_mensal,0)) FROM cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.ativo), 0),
           custo_operacao = coalesce((SELECT sum(coalesce(cp.vlr_custo,0))  FROM cliente_produtos cp WHERE cp.cliente_id = c.id AND cp.ativo), 0),
           updated_at     = now()
     WHERE c.id = r.cli;

    v_res := v_res || format(E'\n%s: %s apagado | %s modulos, %s eventos, %s anexo, %s log calculadora -> %s | fila Omie -%s, recon -%s | mensalidade %s, custo %s',
      r.cliente, r.novo, v_mods, v_ev, v_anx, v_log, r.velho, v_fila, v_rec,
      (SELECT mensalidade FROM clientes WHERE id = r.cli), (SELECT custo_operacao FROM clientes WHERE id = r.cli));
  END LOOP;

  RAISE NOTICE 'LIMPEZA_OK%', v_res;
END $$;
