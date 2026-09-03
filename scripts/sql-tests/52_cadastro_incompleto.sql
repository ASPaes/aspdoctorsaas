-- ============================================================================
-- Smoke test do saneamento de cadastro (03/09/2026)
--
-- Bloco DO terminando em RAISE EXCEPTION: rollback automático, seguro no SQL
-- Editor de produção.
--
-- Esperado:
--   D  valor de OUTRO tenant        -> recusa, e não grava
--   A  resumo                       -> conta certo e omite campo sem pendência
--   A2 lista                        -> só quem está sem o campo
--   B  preencher em lote            -> grava só em quem estava vazio
--   C  campo de produto             -> log aponta o cliente do produto certo
--   E  campo que não é de lote      -> recusa com motivo
--   F  data futura                  -> recusa
--   G  data de hoje                 -> grava
--
-- D vem PRIMEIRO de propósito: rodando depois de um update bem-sucedido, ele
-- passava mesmo com a guarda quebrada. Foi assim que o bug apareceu — EXECUTE
-- de SELECT sem INTO não altera o FOUND do PL/pgSQL, então `if not found` lia
-- o resultado da operação anterior e um id de outra empresa passava.
--
-- Unidade não é testada porque o CHECK clientes_unidade_base_obrigatoria
-- impede criar cliente sem ela — os casos que existem na base são resíduo de
-- antes do CHECK, e essa pendência não pode crescer. Área de atuação é do
-- mesmo escopo e não tem a trava.
-- ============================================================================

DO $smoke$
DECLARE
  v_t    uuid := 'aaaaaaaa-0000-0000-0000-0000000000b1';
  v_unid bigint := 889999; v_prod bigint := 887777; v_area bigint := 885555;
  v_func bigint := 886666; v_user uuid := 'aaaaaaaa-0000-0000-0000-0000000000b9';
  v_c1 uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1';
  v_c2 uuid := 'aaaaaaaa-0000-0000-0000-0000000000a2';
  v_c3 uuid := 'aaaaaaaa-0000-0000-0000-0000000000a3';
  v_cp1 uuid; v_cp2 uuid; r jsonb;
BEGIN
  PERFORM set_config('role','service_role',true);
  INSERT INTO tenants (id, nome) VALUES (v_t,'SMOKE CADASTRO INC');
  INSERT INTO unidades_base (id, tenant_id, nome) VALUES (v_unid, v_t,'Unidade A');
  INSERT INTO produtos (id, tenant_id, nome) VALUES (v_prod, v_t,'Produto A');
  INSERT INTO areas_atuacao (id, tenant_id, nome) VALUES (v_area, v_t,'Comercio');
  INSERT INTO funcionarios (id, tenant_id, nome, ativo) VALUES (v_func, v_t,'Vendedor A', false);
  INSERT INTO profiles (user_id, tenant_id, role, is_super_admin) VALUES (v_user, v_t,'admin', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text)::text, true);

  INSERT INTO clientes (id, tenant_id, razao_social, unidade_base_id, area_atuacao_id)
    VALUES (v_c1, v_t,'CLI UM', v_unid, null), (v_c2, v_t,'CLI DOIS', v_unid, v_area),
           (v_c3, v_t,'CLI TRES', v_unid, null);
  INSERT INTO cliente_produtos (tenant_id, cliente_id, produto_id, ativo, funcionario_id)
    VALUES (v_t, v_c1, v_prod, true, null) RETURNING id INTO v_cp1;
  INSERT INTO cliente_produtos (tenant_id, cliente_id, produto_id, ativo, funcionario_id)
    VALUES (v_t, v_c2, v_prod, true, v_func) RETURNING id INTO v_cp2;

  r := public.fn_cadastro_preencher_lote(v_t,'area_atuacao_id', array[v_c3], '1');
  IF (r->>'ok')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHA D: aceitou valor de outro tenant: %', r::text; END IF;
  IF (SELECT area_atuacao_id FROM clientes WHERE id=v_c3) IS NOT NULL THEN
    RAISE EXCEPTION 'FALHA D2: gravou mesmo recusando';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.fn_cadastro_incompleto_resumo(v_t)
                  WHERE campo='area_atuacao_id' AND faltando=2) THEN
    RAISE EXCEPTION 'FALHA A: resumo errado';
  END IF;
  IF (SELECT count(*) FROM public.fn_cadastro_incompleto_lista(v_t,'area_atuacao_id',null,null,null,50,0)) <> 2 THEN
    RAISE EXCEPTION 'FALHA A2: lista errada';
  END IF;

  r := public.fn_cadastro_preencher_lote(v_t,'area_atuacao_id', array[v_c1, v_c2], v_area::text);
  IF (r->>'gravados')::int <> 1 OR (r->>'ja_preenchidos')::int <> 1 THEN
    RAISE EXCEPTION 'FALHA B: %', r::text;
  END IF;

  r := public.fn_cadastro_preencher_lote(v_t,'funcionario_id', array[v_cp1, v_cp2], v_func::text);
  IF (r->>'gravados')::int <> 1 THEN RAISE EXCEPTION 'FALHA C: %', r::text; END IF;
  IF NOT EXISTS (SELECT 1 FROM cadastro_lote_log
                  WHERE tabela='cliente_produtos' AND registro_id=v_cp1 AND cliente_id=v_c1) THEN
    RAISE EXCEPTION 'FALHA C2: log apontou cliente errado';
  END IF;

  r := public.fn_cadastro_preencher_lote(v_t,'telefone_whatsapp', array[v_c1], 'x');
  IF (r->>'ok')::boolean IS NOT FALSE OR position('cada cliente tem o seu' in (r->>'erro')) = 0 THEN
    RAISE EXCEPTION 'FALHA E: %', r::text;
  END IF;

  r := public.fn_cadastro_preencher_lote(v_t,'data_venda', array[v_cp1], (current_date + 1)::text);
  IF (r->>'ok')::boolean IS NOT FALSE THEN RAISE EXCEPTION 'FALHA F: aceitou data futura'; END IF;
  r := public.fn_cadastro_preencher_lote(v_t,'data_venda', array[v_cp1], current_date::text);
  IF (r->>'gravados')::int <> 1 THEN RAISE EXCEPTION 'FALHA G: %', r::text; END IF;

  RAISE EXCEPTION 'SMOKE_OK|logs=%', (SELECT count(*) FROM cadastro_lote_log WHERE tenant_id=v_t);
END
$smoke$;
