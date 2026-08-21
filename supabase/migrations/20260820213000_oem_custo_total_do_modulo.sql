-- ============================================================================
-- O custo de um módulo do OEM é o valor_total que ele manda, nunca
-- quantidade × valor_unitario.
--
-- O payload de módulos do OEM traz `quantidade`, `valor_unitario` E
-- `valor_total`. Só o `valor_total` é a autoridade: a soma dele bate com o
-- `oem_espelho_filial.custo_total` (o "VALOR ATUAL" da tela do parceiro) em
-- 2571 de 2571 filiais. Já `quantidade × valor_unitario` diverge em 1020,
-- porque o OEM concede unidade grátis e crédito:
--
--   Totem           2 × 25,00  → OEM cobra 25,00
--   Licença PDV     1 × 32,50  → OEM cobra  0,00
--   Licença PDV     3 × 37,86  → OEM cobra 75,73   (paga 2 de 3)
--   e há linhas com total NEGATIVO (-18,73)
--
-- Nada disso é derivável da quantidade — por isso o número tem que vir do
-- parceiro, não de conta nossa. Medido em 20/08/2026: 233 clientes com produto
-- ativo estavam com o custo inflado, R$ 554,07/mês somados.
-- ============================================================================

ALTER TABLE public.cliente_produto_modulos
  ADD COLUMN IF NOT EXISTS vlr_custo_total numeric;

COMMENT ON COLUMN public.cliente_produto_modulos.vlr_custo_total IS
  'Custo TOTAL da linha como o parceiro cobra (OEM: valor_total). Quando preenchido, manda sobre vlr_custo × quantidade. NULL em módulo digitado à mão, que segue multiplicando.';

-- ============================================================================
-- 1. O espelho passa a trazer o valor_total.
--    Só muda o SELECT do jsonb_to_recordset e as duas escritas do custo; o
--    resto da função é o que já estava em produção.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_espelhar_modulos_no_contrato(
  p_tenant_id uuid, p_filial_codigo text, p_modulos jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp              record;
  v_m               record;
  v_modulo_id       uuid;
  v_chaves          text[];
  v_n               int;
  v_criados_catalogo int := 0;
  v_vinculados      int := 0;
  v_atualizados     int := 0;
  v_inativados      int := 0;
  v_apagados        int := 0;
BEGIN
  IF p_modulos IS NULL OR jsonb_typeof(p_modulos) <> 'array' THEN
    RETURN jsonb_build_object('ignorado', 'filial sem lista de módulos');
  END IF;

  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  SELECT array_agg(DISTINCT public.fn_norm_nome_modulo(x.nome))
    INTO v_chaves
    FROM jsonb_to_recordset(p_modulos) AS x(nome text, ativo boolean)
   WHERE coalesce(x.ativo, true) = true AND coalesce(btrim(x.nome), '') <> '';

  FOR v_cp IN
    SELECT cp.id, cp.produto_id, cp.tenant_id
      FROM public.cliente_produtos cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.oem_codigo_filial = p_filial_codigo
  LOOP
    FOR v_m IN
      SELECT DISTINCT ON (public.fn_norm_nome_modulo(x.nome))
             btrim(x.nome)                     AS nome,
             public.fn_norm_nome_modulo(x.nome) AS chave,
             x.codigo                          AS codigo,
             greatest(coalesce(x.quantidade, 1), 1) AS quantidade,
             coalesce(x.valor_unitario, 0)     AS valor,
             -- O total do parceiro. Ausente (payload antigo) fica NULL e a
             -- linha volta a multiplicar, que é o comportamento de antes.
             x.valor_total                     AS valor_total
        FROM jsonb_to_recordset(p_modulos)
             AS x(nome text, codigo int, ativo boolean,
                  quantidade numeric, valor_unitario numeric, valor_total numeric)
       WHERE coalesce(x.ativo, true) = true
         AND coalesce(btrim(x.nome), '') <> ''
       ORDER BY public.fn_norm_nome_modulo(x.nome), x.codigo
    LOOP
      SELECT m.id INTO v_modulo_id
        FROM public.produto_modulos m
       WHERE m.produto_id = v_cp.produto_id
         AND public.fn_norm_nome_modulo(m.nome) = v_m.chave
       ORDER BY m.created_at
       LIMIT 1;

      IF v_modulo_id IS NULL THEN
        INSERT INTO public.produto_modulos
          (tenant_id, produto_id, nome, descricao, ativo, vlr_custo, margem_percentual, vlr_venda)
        VALUES
          (v_cp.tenant_id, v_cp.produto_id, v_m.nome,
           'Importado do OEM · módulo #' || coalesce(v_m.codigo, 0), true, v_m.valor, 0, 0)
        RETURNING id INTO v_modulo_id;
        v_criados_catalogo := v_criados_catalogo + 1;
      END IF;

      UPDATE public.cliente_produto_modulos c
         SET quantidade        = coalesce(c.quantidade_manual, v_m.quantidade),
             vlr_custo         = v_m.valor,
             vlr_custo_total   = v_m.valor_total,
             oem_modulo_codigo = v_m.codigo,
             quantidade_manual = CASE WHEN coalesce(c.quantidade_manual, -1) = v_m.quantidade
                                      THEN NULL ELSE c.quantidade_manual END,
             ativo             = CASE WHEN c.cancelado_manual THEN c.ativo ELSE true END,
             data_inativacao   = CASE WHEN c.cancelado_manual THEN c.data_inativacao ELSE NULL END,
             updated_at        = now()
       WHERE c.cliente_produto_id = v_cp.id
         AND c.modulo_id = v_modulo_id
         AND c.origem = 'oem';
      GET DIAGNOSTICS v_n = ROW_COUNT;

      IF v_n > 0 THEN
        v_atualizados := v_atualizados + v_n;
      ELSIF NOT EXISTS (
        SELECT 1 FROM public.cliente_produto_modulos c
         WHERE c.cliente_produto_id = v_cp.id AND c.modulo_id = v_modulo_id
      ) THEN
        INSERT INTO public.cliente_produto_modulos
          (tenant_id, cliente_produto_id, modulo_id, quantidade,
           vlr_custo, vlr_custo_total, vlr_mensal, ativo, origem, data_ativacao, oem_modulo_codigo)
        VALUES
          (v_cp.tenant_id, v_cp.id, v_modulo_id, v_m.quantidade,
           v_m.valor, v_m.valor_total, 0, true, 'oem', current_date, v_m.codigo);
        v_vinculados := v_vinculados + 1;
      END IF;
    END LOOP;

    DELETE FROM public.cliente_produto_modulos c
     USING public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND c.cancelado_manual = false
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)))
       AND NOT EXISTS (
         SELECT 1 FROM public.movimentos_mrr mv WHERE mv.cliente_produto_modulo_id = c.id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_apagados := v_apagados + v_n;

    UPDATE public.cliente_produto_modulos c
       SET ativo = false, data_inativacao = current_date, updated_at = now()
      FROM public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND c.ativo
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inativados := v_inativados + v_n;
  END LOOP;

  RETURN jsonb_build_object(
    'vinculados',       v_vinculados,
    'atualizados',      v_atualizados,
    'inativados',       v_inativados,
    'apagados',         v_apagados,
    'criados_catalogo', v_criados_catalogo
  );
END;
$$;

ALTER FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) OWNER TO postgres;

-- ============================================================================
-- 2. A soma que alimenta cliente_produtos.vlr_custo respeita o total do parceiro.
--    vlr_mensal (nossa receita) continua multiplicando: preço de venda é nosso,
--    quem dá unidade grátis é o OEM, no custo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_sync_produto_valores() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_produto_id uuid;
  v_soma_mensal numeric;
  v_soma_custo numeric;
  v_count_ativos integer;
BEGIN
  IF current_setting('doctorsaas.skip_valor_sync', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_cliente_produto_id := OLD.cliente_produto_id;
  ELSE
    v_cliente_produto_id := NEW.cliente_produto_id;
  END IF;

  SELECT
    COALESCE(SUM(COALESCE(vlr_mensal, 0) * quantidade), 0),
    COALESCE(SUM(COALESCE(vlr_custo_total, COALESCE(vlr_custo, 0) * quantidade)), 0),
    COUNT(*)
  INTO v_soma_mensal, v_soma_custo, v_count_ativos
  FROM cliente_produto_modulos
  WHERE cliente_produto_id = v_cliente_produto_id
    AND ativo = true;

  IF v_count_ativos = 0 OR v_soma_mensal = 0 THEN
    UPDATE cliente_produtos
    SET updated_at = now()
    WHERE id = v_cliente_produto_id;
    RETURN NULL;
  END IF;

  UPDATE cliente_produtos
  SET
    vlr_mensal = v_soma_mensal,
    vlr_custo = v_soma_custo,
    updated_at = now()
  WHERE id = v_cliente_produto_id;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.fn_sync_produto_valores() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_sync_produto_valores() IS
  'Sincroniza vlr_mensal/vlr_custo de cliente_produtos a partir dos modulos ativos. O custo usa vlr_custo_total quando o parceiro manda um (OEM da unidade gratis e credito); sem ele, multiplica. Preserva valor digitado quando nao ha modulos ativos OU quando a soma mensal = 0. Skip via doctorsaas.skip_valor_sync=true.';

-- ============================================================================
-- 3. Backfill do que já está gravado.
--    Sem o skip, cada UPDATE dispararia fn_sync_produto_valores por linha e
--    recalcularia o mesmo produto dezenas de vezes; o recálculo vem depois, uma
--    vez por produto. O gatilho do Omie não entra: ele só escuta
--    vlr_mensal/quantidade/ativo, e nenhum dos dois é tocado aqui.
-- ============================================================================
DO $backfill$
DECLARE
  v_linhas int;
  v_produtos int;
BEGIN
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  WITH filial AS (
    -- Uma linha por (tenant, filial): a mesma filial pode aparecer em mais de
    -- uma conta do OEM, e aí vale o espelho mais recente.
    SELECT DISTINCT ON (ef.tenant_id, ef.filial_codigo)
           ef.tenant_id, ef.filial_codigo, ef.modulos
      FROM public.oem_espelho_filial ef
     WHERE jsonb_typeof(ef.modulos) = 'array'
     ORDER BY ef.tenant_id, ef.filial_codigo, ef.atualizado_em DESC
  ),
  modulo AS (
    SELECT f.tenant_id, f.filial_codigo, x.codigo, x.valor_total
      FROM filial f
           CROSS JOIN LATERAL jsonb_to_recordset(f.modulos)
             AS x(codigo int, ativo boolean, valor_total numeric)
     WHERE coalesce(x.ativo, true) = true
       AND x.codigo IS NOT NULL
       AND x.valor_total IS NOT NULL
  )
  UPDATE public.cliente_produto_modulos c
     SET vlr_custo_total = m.valor_total,
         updated_at      = now()
    FROM public.cliente_produtos cp
         JOIN modulo m
           ON m.tenant_id = cp.tenant_id
          AND m.filial_codigo = cp.oem_codigo_filial
   WHERE c.cliente_produto_id = cp.id
     AND c.origem = 'oem'
     AND c.oem_modulo_codigo = m.codigo
     AND c.vlr_custo_total IS DISTINCT FROM m.valor_total;
  GET DIAGNOSTICS v_linhas = ROW_COUNT;

  -- Recalcula o custo do produto uma vez por produto tocado, com a mesma regra
  -- da fn_sync_produto_valores (inclusive o "não zera o que foi digitado").
  WITH soma AS (
    SELECT c.cliente_produto_id AS id,
           SUM(coalesce(c.vlr_mensal, 0) * c.quantidade) AS mensal,
           SUM(coalesce(c.vlr_custo_total, coalesce(c.vlr_custo, 0) * c.quantidade)) AS custo
      FROM public.cliente_produto_modulos c
     WHERE c.ativo = true
       AND EXISTS (
         SELECT 1 FROM public.cliente_produto_modulos d
          WHERE d.cliente_produto_id = c.cliente_produto_id
            AND d.origem = 'oem'
            AND d.vlr_custo_total IS NOT NULL
       )
     GROUP BY c.cliente_produto_id
  )
  UPDATE public.cliente_produtos cp
     SET vlr_custo = soma.custo,
         updated_at = now()
    FROM soma
   WHERE cp.id = soma.id
     AND soma.mensal <> 0
     AND cp.vlr_custo IS DISTINCT FROM soma.custo;
  GET DIAGNOSTICS v_produtos = ROW_COUNT;

  RAISE NOTICE 'backfill vlr_custo_total: % linhas de modulo, % produtos recalculados', v_linhas, v_produtos;
END
$backfill$;
