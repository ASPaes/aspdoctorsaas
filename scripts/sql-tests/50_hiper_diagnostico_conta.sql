-- ============================================================================
-- Smoke test do hiper_diagnostico_conta
--
-- Statement único (bloco DO) terminando em RAISE EXCEPTION: rollback automático,
-- seguro no SQL Editor de produção.
--
-- A função existe porque "Conta sem cliente aqui" é ambíguo: pode ser cliente
-- que nunca foi cadastrado, ou cliente cadastrado que o cruzamento não enxerga.
-- Cada caso pede uma ação diferente, e a tela precisa dizer qual.
--
-- Esperado:
--   A  sem divergência                       -> ok
--   B  divergência que não é sem_dono        -> divergente
--   C  CNPJ cadastrado, sem contrato Hiper   -> cnpj_cadastrado_sem_contrato_hiper
--   D  mesma razão social, CNPJ em branco    -> cadastro_sem_cnpj
--   E  nada parecido na base                 -> sem_cadastro
--   F  CNPJ cadastrado COM contrato Hiper    -> comparacao_desatualizada
-- ============================================================================

DO $smoke$
DECLARE
  v_t    uuid := 'aaaaaaaa-0000-0000-0000-00000000d1d1';
  v_forn bigint := 939393;
  v_prod bigint := 929292;
  v_unid bigint := 919191;
  d      jsonb;
  v_out  text := '';
BEGIN
  PERFORM set_config('role', 'service_role', true);

  INSERT INTO tenants (id, nome) VALUES (v_t, 'SMOKE DIAG');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES (v_unid, v_t, 'Unidade Smoke');
  INSERT INTO fornecedores (id, tenant_id, nome) VALUES (v_forn, v_t, 'Hiper Smoke');
  INSERT INTO produtos (id, tenant_id, nome) VALUES (v_prod, v_t, 'Hiper Gestao Smoke');
  INSERT INTO hiper_integration (tenant_id, ativo, fornecedor_id) VALUES (v_t, true, v_forn);
  INSERT INTO hiper_catalogo_vinculo (tenant_id, tipo, chave, produto_id)
    VALUES (v_t, 'plano', 'Hiper Gestao - Mensal', v_prod);

  INSERT INTO reconciliacao_hiper (tenant_id, id_portal, cnpj_norm, razao_social_hiper,
                                   situacao_hiper, plano_hiper, responsavel_tipo,
                                   estado_match, divergencias, status_usuario)
  VALUES
    (v_t, 'D-A', '11111111000111', 'TUDO CERTO LTDA',      'ativo', 'Hiper Gestao - Mensal', 'hiper', 'vinculado', ARRAY[]::text[],            'pendente'),
    (v_t, 'D-B', '22222222000122', 'SO CUSTO LTDA',        'ativo', 'Hiper Gestao - Mensal', 'hiper', 'vinculado', ARRAY['custo_divergente'],  'pendente'),
    (v_t, 'D-C', '33333333000133', 'CANCELADO AQUI LTDA',  'ativo', 'Hiper Gestao - Mensal', 'hiper', 'sem_dono',  ARRAY['sem_dono'],          'pendente'),
    (v_t, 'D-D', '44444444000144', '44.444.444 JOAO DA SILVA', 'ativo', 'Hiper Gestao - Mensal', 'hiper', 'sem_dono', ARRAY['sem_dono'],       'pendente'),
    (v_t, 'D-E', '55555555000155', 'NUNCA VISTO LTDA',     'ativo', 'Hiper Gestao - Mensal', 'hiper', 'sem_dono',  ARRAY['sem_dono'],          'pendente');

  -- C: existe cadastro com o CNPJ, cancelado e sem nenhum produto do Hiper
  INSERT INTO clientes (tenant_id, razao_social, cnpj, unidade_base_id, cancelado)
    VALUES (v_t, 'Cancelado Aqui Ltda', '33.333.333/0001-33', v_unid, true);

  -- D: mesma razão social do portal, com o CNPJ EM BRANCO. É o caso que o
  --    cruzamento por CNPJ não enxerga por mais que todo o resto bata.
  INSERT INTO clientes (tenant_id, razao_social, cnpj, unidade_base_id, cancelado)
    VALUES (v_t, '44.444.444 Joao da Silva', NULL, v_unid, false);

  ---------------------------------------------------------------- A
  d := public.hiper_diagnostico_conta(v_t, 'D-A');
  IF d->>'estado' <> 'ok' THEN RAISE EXCEPTION 'FALHA A: %', d::text; END IF;

  ---------------------------------------------------------------- B
  d := public.hiper_diagnostico_conta(v_t, 'D-B');
  IF d->>'estado' <> 'divergente' THEN RAISE EXCEPTION 'FALHA B: %', d::text; END IF;

  ---------------------------------------------------------------- C
  d := public.hiper_diagnostico_conta(v_t, 'D-C');
  IF d->>'motivo' <> 'cnpj_cadastrado_sem_contrato_hiper' THEN RAISE EXCEPTION 'FALHA C: %', d::text; END IF;
  IF (d->>'cancelado')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FALHA C: nao disse que esta cancelado: %', d::text; END IF;

  ---------------------------------------------------------------- D
  d := public.hiper_diagnostico_conta(v_t, 'D-D');
  IF d->>'motivo' <> 'cadastro_sem_cnpj' THEN RAISE EXCEPTION 'FALHA D: %', d::text; END IF;
  -- o resumo precisa trazer o CNPJ a digitar: é a ação que resolve
  IF position('44444444000144' in (d->>'resumo')) = 0 THEN
    RAISE EXCEPTION 'FALHA D: resumo sem o CNPJ a preencher: %', d->>'resumo';
  END IF;
  v_out := v_out || format('D=%s | ', d->>'resumo');

  ---------------------------------------------------------------- E
  d := public.hiper_diagnostico_conta(v_t, 'D-E');
  IF d->>'motivo' <> 'sem_cadastro' THEN RAISE EXCEPTION 'FALHA E: %', d::text; END IF;

  ---------------------------------------------------------------- F
  -- Com contrato Hiper ativo, o cadastro DEVERIA ter sido vinculado. Se a conta
  -- continua órfã, quem está velha é a comparação — e a ação muda: não é mexer
  -- no cadastro, é refazer a verificação.
  INSERT INTO cliente_produtos (tenant_id, cliente_id, produto_id, fornecedor_id, ativo)
  SELECT v_t, c.id, v_prod, v_forn, true FROM clientes c
   WHERE c.tenant_id = v_t AND c.cnpj_digits = '33333333000133';
  d := public.hiper_diagnostico_conta(v_t, 'D-C');
  IF d->>'motivo' <> 'comparacao_desatualizada' THEN RAISE EXCEPTION 'FALHA F: %', d::text; END IF;

  RAISE EXCEPTION 'SMOKE_OK|%', v_out;
END
$smoke$;
