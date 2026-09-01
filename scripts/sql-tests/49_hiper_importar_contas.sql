-- ============================================================================
-- Smoke test do hiper_importar_contas
--
-- Statement único (bloco DO) terminando em RAISE EXCEPTION: o resultado volta
-- na mensagem de erro e o rollback é automático. Seguro no SQL Editor de
-- produção — nenhuma das linhas criadas aqui sobrevive.
--
-- Esperado:
--   A  conta nova, plano ANUAL      -> cliente + cliente_produto + contrato,
--                                      recorrencia 'anual' (entrar como mensal
--                                      multiplicaria o MRR por 12)
--   B  CNPJ já cadastrado aqui      -> recusada, sem criar duplicado
--   C  e-mail vazio                 -> recusada
--   D  unidade base de outro tenant -> lote inteiro recusado (ok=false)
-- ============================================================================

DO $smoke$
DECLARE
  v_t     uuid := 'aaaaaaaa-0000-0000-0000-00000000f1f1';
  v_out   uuid := 'aaaaaaaa-0000-0000-0000-00000000f2f2';  -- tenant vizinho
  v_forn  bigint := 979797;
  v_prod  bigint := 989898;
  v_mod   bigint := 969696;   -- modelo de contrato
  v_unid  bigint := 959595;
  v_unid_out bigint := 949494;
  v_ja    uuid := 'aaaaaaaa-0000-0000-0000-00000000c1c1';
  r       jsonb;
  v_cli   uuid;
  v_cp    record;
  v_ct    int;
  v_dupes int;
  v_out_t text := '';
BEGIN
  PERFORM set_config('role', 'service_role', true);

  ---------------------------------------------------------------- fixture
  INSERT INTO tenants (id, nome) VALUES (v_t, 'SMOKE HIPER'), (v_out, 'SMOKE VIZINHO');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES
    (v_unid, v_t, 'Unidade Smoke'), (v_unid_out, v_out, 'Unidade do Vizinho');
  INSERT INTO fornecedores (id, tenant_id, nome) VALUES (v_forn, v_t, 'Hiper Smoke');
  INSERT INTO produtos (id, tenant_id, nome) VALUES (v_prod, v_t, 'Hiper Gestão Smoke');
  INSERT INTO modelos_contrato (id, tenant_id, nome) VALUES (v_mod, v_t, 'Royalties Smoke');
  INSERT INTO hiper_integration (tenant_id, ativo, fornecedor_id) VALUES (v_t, true, v_forn);
  INSERT INTO hiper_catalogo_vinculo (tenant_id, tipo, chave, produto_id) VALUES
    (v_t, 'plano', 'Hiper Gestão - Anual', v_prod);
  INSERT INTO hiper_catalogo_vinculo (tenant_id, tipo, chave, modelo_contrato_id) VALUES
    (v_t, 'contrato', 'hiper', v_mod);

  -- O cliente que já existe: cancelado e sem produto, que é exatamente o caso
  -- que a reconciliação chama de "conta sem cliente aqui".
  INSERT INTO clientes (id, tenant_id, razao_social, cnpj, unidade_base_id, cancelado)
  VALUES (v_ja, v_t, 'JA CADASTRADO LTDA', '22.222.222/0001-22', v_unid, true);

  INSERT INTO hiper_espelho_cadastro (tenant_id, id_portal, cnpj, cnpj_norm, razao_social,
                                      nome_fantasia, cidade, uf, situacao, responsavel_tipo, plano)
  VALUES
    (v_t, 'P-A', '11.111.111/0001-11', '11111111000111', 'CONTA NOVA LTDA',
     'Conta Nova', 'BRUSQUE', 'SC', 'ativo', 'hiper', 'Hiper Gestão - Anual'),
    (v_t, 'P-B', '22.222.222/0001-22', '22222222000122', 'JA CADASTRADO LTDA',
     'Ja Cadastrado', 'BRUSQUE', 'SC', 'ativo', 'hiper', 'Hiper Gestão - Anual'),
    (v_t, 'P-C', '33.333.333/0001-33', '33333333000133', 'SEM EMAIL LTDA',
     'Sem Email', 'BRUSQUE', 'SC', 'ativo', 'hiper', 'Hiper Gestão - Anual');

  INSERT INTO reconciliacao_hiper (tenant_id, id_portal, cnpj_norm, razao_social_hiper,
                                   situacao_hiper, plano_hiper, responsavel_tipo, custo_hiper,
                                   estado_match, divergencias, status_usuario)
  VALUES
    (v_t, 'P-A', '11111111000111', 'CONTA NOVA LTDA', 'ativo', 'Hiper Gestão - Anual',
     'hiper', 100.00, 'orfao', ARRAY['sem_dono'], 'pendente'),
    (v_t, 'P-B', '22222222000122', 'JA CADASTRADO LTDA', 'ativo', 'Hiper Gestão - Anual',
     'hiper', 50.00, 'orfao', ARRAY['sem_dono'], 'pendente'),
    (v_t, 'P-C', '33333333000133', 'SEM EMAIL LTDA', 'ativo', 'Hiper Gestão - Anual',
     'hiper', 70.00, 'orfao', ARRAY['sem_dono'], 'pendente');

  ---------------------------------------------------------------- A, B e C
  r := public.hiper_importar_contas(
    v_t,
    jsonb_build_object('unidade_base_id', v_unid, 'data_inicio', current_date::text,
                       'dia_vencimento', 10),
    jsonb_build_array(
      jsonb_build_object('id_portal','P-A','mensalidade',300,'email','a@a.com','whatsapp','(47) 99999-1111'),
      jsonb_build_object('id_portal','P-B','mensalidade',300,'email','b@b.com','whatsapp','(47) 99999-2222'),
      jsonb_build_object('id_portal','P-C','mensalidade',300,'email','',       'whatsapp','(47) 99999-3333')
    ));

  v_out_t := v_out_t || format('criados=%s recusados=%s | ',
    jsonb_array_length(r->'criados'), r->'recusados');

  IF jsonb_array_length(r->'criados') <> 1 THEN
    RAISE EXCEPTION 'FALHA A: esperava 1 criado, veio %  [%]', jsonb_array_length(r->'criados'), r::text;
  END IF;

  v_cli := (r->'criados'->0->>'cliente_id')::uuid;
  SELECT * INTO v_cp FROM cliente_produtos WHERE cliente_id = v_cli;
  SELECT count(*) INTO v_ct FROM contratos WHERE cliente_id = v_cli;

  IF v_cp.id IS NULL THEN RAISE EXCEPTION 'FALHA A: cliente sem cliente_produto'; END IF;
  IF v_ct <> 1        THEN RAISE EXCEPTION 'FALHA A: esperava 1 contrato, veio %', v_ct; END IF;
  IF v_cp.recorrencia::text <> 'anual' THEN
    RAISE EXCEPTION 'FALHA A: plano anual entrou como %', v_cp.recorrencia;
  END IF;
  IF v_cp.vlr_custo <> 100.00 THEN
    RAISE EXCEPTION 'FALHA A: custo do portal não veio (%)', v_cp.vlr_custo;
  END IF;
  IF v_cp.fornecedor_id <> v_forn OR v_cp.modelo_contrato_id <> v_mod THEN
    RAISE EXCEPTION 'FALHA A: fornecedor/modelo errados (% / %)', v_cp.fornecedor_id, v_cp.modelo_contrato_id;
  END IF;

  -- B não pode ter virado cadastro novo
  SELECT count(*) INTO v_dupes FROM clientes
   WHERE tenant_id = v_t AND cnpj_digits = '22222222000122';
  IF v_dupes <> 1 THEN
    RAISE EXCEPTION 'FALHA B: CNPJ já cadastrado virou % cadastros', v_dupes;
  END IF;

  -- C não pode ter entrado
  IF EXISTS (SELECT 1 FROM clientes WHERE tenant_id = v_t AND cnpj_digits = '33333333000133') THEN
    RAISE EXCEPTION 'FALHA C: conta sem e-mail foi importada';
  END IF;
  IF jsonb_array_length(r->'recusados') <> 2 THEN
    RAISE EXCEPTION 'FALHA B/C: esperava 2 recusas, veio %', r->'recusados';
  END IF;

  ---------------------------------------------------------------- D
  r := public.hiper_importar_contas(
    v_t,
    jsonb_build_object('unidade_base_id', v_unid_out, 'data_inicio', current_date::text),
    jsonb_build_array(jsonb_build_object('id_portal','P-C','mensalidade',1,'email','c@c.com','whatsapp','47999993333')));
  IF (r->>'ok')::boolean IS NOT FALSE THEN
    RAISE EXCEPTION 'FALHA D: unidade de outro tenant foi aceita [%]', r::text;
  END IF;
  v_out_t := v_out_t || format('D=%s', r->>'erro');

  RAISE EXCEPTION 'SMOKE_OK|%', v_out_t;
END
$smoke$;
