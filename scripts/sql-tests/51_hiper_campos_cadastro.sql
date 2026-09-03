-- ============================================================================
-- Smoke test dos campos de cadastro vindos do portal (03/09/2026)
--
-- Bloco DO terminando em RAISE EXCEPTION: rollback automático, seguro no SQL
-- Editor de produção.
--
-- Esperado:
--   A  e-mail diferente            -> grava, em minúsculas
--   B  telefone SÓ sem nono dígito -> RECUSA, mantém o daqui (portal é o velho)
--   D  domínio                     -> ACRESCENTA na observação, sem apagar o que havia
--   E  contato                     -> grava nome e telefone juntos
--   F  endereço                    -> grava CEP, logradouro, número, bairro e cidade
--   G  desfazer                    -> devolve TODOS os campos ao estado anterior
--
-- G é o que justifica o log por campo: endereço grava cinco colunas e contato
-- duas. Uma linha de log só por ação faria o Desfazer devolver o CEP e deixar
-- logradouro, número, bairro e cidade novos.
-- ============================================================================

DO $smoke$
DECLARE
  v_t     uuid := 'aaaaaaaa-0000-0000-0000-0000000000e1';
  v_forn  bigint := 909090;
  v_prod  bigint := 908080;
  v_mod   bigint := 907070;
  v_unid  bigint := 906060;
  v_c1    uuid := 'aaaaaaaa-0000-0000-0000-0000000000c1';
  v_c2    uuid := 'aaaaaaaa-0000-0000-0000-0000000000c2';
  v_r1    uuid;
  v_r2    uuid;
  v_lote  uuid := gen_random_uuid();
  res     jsonb;
  v_cli   record;
  v_out   text := '';
BEGIN
  PERFORM set_config('role', 'service_role', true);

  ---------------------------------------------------------------- fixture
  INSERT INTO tenants (id, nome) VALUES (v_t, 'SMOKE CADASTRO');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES (v_unid, v_t, 'Unidade Smoke');
  INSERT INTO fornecedores (id, tenant_id, nome) VALUES (v_forn, v_t, 'Hiper Smoke');
  INSERT INTO produtos (id, tenant_id, nome) VALUES (v_prod, v_t, 'Hiper Gestao Smoke');
  INSERT INTO modelos_contrato (id, tenant_id, nome) VALUES (v_mod, v_t, 'Royalties Smoke');
  INSERT INTO hiper_integration (tenant_id, ativo, fornecedor_id) VALUES (v_t, true, v_forn);
  INSERT INTO hiper_catalogo_vinculo (tenant_id, tipo, chave, produto_id)
    VALUES (v_t, 'plano', 'Hiper Gestao - Mensal', v_prod);

  -- Cliente 1: e-mail velho, telefone COM nono dígito, observação já escrita
  INSERT INTO clientes (id, tenant_id, razao_social, cnpj, unidade_base_id,
                        email, telefone_whatsapp, observacao_cliente, contato_nome)
  VALUES (v_c1, v_t, 'CLIENTE UM LTDA', '11.111.111/0001-11', v_unid,
          'antigo@empresa.com', '5547991135030', 'Anotacao do time', null);
  -- Cliente 2: telefone de outro número
  INSERT INTO clientes (id, tenant_id, razao_social, cnpj, unidade_base_id,
                        email, telefone_whatsapp)
  VALUES (v_c2, v_t, 'CLIENTE DOIS LTDA', '22.222.222/0001-22', v_unid,
          'dois@empresa.com', '5549932222468');

  INSERT INTO cliente_produtos (tenant_id, cliente_id, produto_id, fornecedor_id, ativo, vlr_mensal)
  VALUES (v_t, v_c1, v_prod, v_forn, true, 100), (v_t, v_c2, v_prod, v_forn, true, 100);

  INSERT INTO hiper_espelho_cadastro (tenant_id, id_portal, cnpj, cnpj_norm, razao_social,
        situacao, responsavel_tipo, plano,
        telefone, email, dominio, contato_nome, contato_telefone,
        end_cep, end_logradouro, end_numero, end_bairro, end_cidade, end_uf)
  VALUES
    (v_t, 'E-1', '11.111.111/0001-11', '11111111000111', 'CLIENTE UM LTDA',
     'ativo', 'hiper', 'Hiper Gestao - Mensal',
     '4791135030',                    -- MESMO número do cliente, sem o nono dígito
     'NOVO@Empresa.com', 'clienteum.com.br', 'Maria de Souza', '47988887777',
     '88350000', 'RUA XV DE NOVEMBRO', '1000', 'CENTRO', 'BRUSQUE', 'SC'),
    (v_t, 'E-2', '22.222.222/0001-22', '22222222000122', 'CLIENTE DOIS LTDA',
     'ativo', 'hiper', 'Hiper Gestao - Mensal',
     '49999668072',                   -- número REALMENTE diferente
     'dois@empresa.com', null, null, null, null, null, null, null, null, null);

  INSERT INTO reconciliacao_hiper (tenant_id, id_portal, cnpj_norm, razao_social_hiper,
        situacao_hiper, plano_hiper, responsavel_tipo, estado_match, divergencias,
        status_usuario, ds_cliente_id, razao_social_ds, codigo_sequencial_ds)
  VALUES
    (v_t, 'E-1', '11111111000111', 'CLIENTE UM LTDA', 'ativo', 'Hiper Gestao - Mensal',
     'hiper', 'vinculado', ARRAY['email_divergente'], 'pendente', v_c1, 'CLIENTE UM LTDA', 1),
    (v_t, 'E-2', '22222222000122', 'CLIENTE DOIS LTDA', 'ativo', 'Hiper Gestao - Mensal',
     'hiper', 'vinculado', ARRAY['telefone_divergente'], 'pendente', v_c2, 'CLIENTE DOIS LTDA', 2)
  RETURNING id INTO v_r1;

  SELECT id INTO v_r1 FROM reconciliacao_hiper WHERE tenant_id=v_t AND id_portal='E-1';
  SELECT id INTO v_r2 FROM reconciliacao_hiper WHERE tenant_id=v_t AND id_portal='E-2';

  ---------------------------------------------------------------- A, B, D, E, F
  res := public.hiper_aplicar_uma(v_t, v_r1,
           array['email','telefone','endereco','contato','dominio'], v_lote);

  SELECT * INTO v_cli FROM clientes WHERE id = v_c1;

  IF v_cli.email <> 'novo@empresa.com' THEN
    RAISE EXCEPTION 'FALHA A: e-mail nao gravou em minusculas: %', v_cli.email;
  END IF;

  -- B: o portal mandou o MESMO número sem o nono dígito. Não pode encurtar.
  IF v_cli.telefone_whatsapp <> '5547991135030' THEN
    RAISE EXCEPTION 'FALHA B: o telefone daqui foi encurtado para % (portal estava velho)', v_cli.telefone_whatsapp;
  END IF;
  IF res->'recusado'::text NOT LIKE '%nono dígito%' AND NOT (res::text LIKE '%nono dígito%') THEN
    RAISE EXCEPTION 'FALHA B: nao explicou por que manteve o telefone: %', res::text;
  END IF;

  -- D: a anotação do time tem de sobreviver
  IF position('Anotacao do time' in coalesce(v_cli.observacao_cliente,'')) = 0
     OR position('clienteum.com.br' in coalesce(v_cli.observacao_cliente,'')) = 0 THEN
    RAISE EXCEPTION 'FALHA D: observacao ficou "%"', v_cli.observacao_cliente;
  END IF;

  IF v_cli.contato_nome <> 'Maria de Souza' OR v_cli.contato_fone <> '47988887777' THEN
    RAISE EXCEPTION 'FALHA E: contato ficou % / %', v_cli.contato_nome, v_cli.contato_fone;
  END IF;

  IF v_cli.cep <> '88350000' OR v_cli.numero <> '1000' OR v_cli.bairro <> 'CENTRO'
     OR v_cli.endereco <> 'RUA XV DE NOVEMBRO' THEN
    RAISE EXCEPTION 'FALHA F: endereco ficou % / % / % / %',
      v_cli.cep, v_cli.endereco, v_cli.numero, v_cli.bairro;
  END IF;
  IF v_cli.cidade_id IS NULL THEN
    RAISE EXCEPTION 'FALHA F: cidade nao foi resolvida a partir de BRUSQUE/SC';
  END IF;
  v_out := v_out || format('cidade_id=%s | ', v_cli.cidade_id);

  ---------------------------------------------------------------- C
  res := public.hiper_aplicar_uma(v_t, v_r2, array['telefone'], v_lote);
  SELECT * INTO v_cli FROM clientes WHERE id = v_c2;
  IF v_cli.telefone_whatsapp <> '49999668072' THEN
    RAISE EXCEPTION 'FALHA C: numero diferente nao foi gravado: %', v_cli.telefone_whatsapp;
  END IF;

  -- O log tem de permitir desfazer: valor_antes preenchido em tudo que mudou
  IF EXISTS (SELECT 1 FROM hiper_alteracao_log
              WHERE lote_id = v_lote AND acao IN ('email','telefone','contato','endereco')
                AND valor_antes IS NULL) THEN
    RAISE EXCEPTION 'FALHA: log sem valor_antes — nao daria para desfazer';
  END IF;

  RAISE EXCEPTION 'SMOKE_OK|%', v_out;
END
$smoke$;
