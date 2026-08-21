-- ============================================================================
-- O módulo do catálogo passa a guardar o código dele no OEM.
--
-- Por que: o OEM chama o MESMO módulo de dois jeitos, em dois lugares.
--   na licença do cliente ......... "Licença PDV"
--   na grade de preços do produto . "PDV/Comandas"
--
-- O catálogo de módulos do DoctorSaaS nasceu das licenças, então guarda
-- "Licença PDV". A tela busca o custo na grade casando por NOME — e esse par
-- nunca casa. Medido em 21/08/2026: dos 35 nomes distintos que aparecem em
-- licença, 34 casam com a grade e **um** não casa. Justamente esse, que aparece
-- em **2.512 licenças** e é o módulo mais comum de todos.
--
-- Casar por nome é frágil por construção: qualquer renomeação de um lado
-- quebra em silêncio e o custo aparece como zero. O código do módulo é o que o
-- parceiro usa como identidade — inclusive para pedir a baixa — e é estável.
-- ============================================================================

ALTER TABLE public.produto_modulos
  ADD COLUMN IF NOT EXISTS oem_modulo_codigo integer;

COMMENT ON COLUMN public.produto_modulos.oem_modulo_codigo IS
  'Código do módulo no catálogo do OEM. É por ele que o custo é buscado na grade do parceiro — casar por nome não funciona: o OEM usa nomes diferentes na licença e na grade.';

CREATE INDEX IF NOT EXISTS idx_produto_modulos_oem_codigo
  ON public.produto_modulos (oem_modulo_codigo)
  WHERE oem_modulo_codigo IS NOT NULL;

-- ============================================================================
-- Backfill em duas fontes, nesta ordem de confiança.
--
-- 1) O que já está gravado nas fichas: cliente_produto_modulos.oem_modulo_codigo
--    veio do espelho, é o código real e cobre o módulo que algum cliente tem.
-- 2) A descrição que o próprio espelho escreveu ao criar o módulo no catálogo
--    ('Importado do OEM · módulo #N'), que alcança o que nenhum cliente tem
--    ainda.
-- ============================================================================
DO $backfill$
DECLARE
  v_por_ficha int;
  v_por_descricao int;
BEGIN
  WITH voto AS (
    -- Um módulo do catálogo pode aparecer em muitas fichas; se houvesse
    -- divergência, vence o código mais frequente. Empate resolve pelo menor,
    -- só para o resultado ser determinístico.
    SELECT DISTINCT ON (c.modulo_id)
           c.modulo_id, c.oem_modulo_codigo, count(*) AS n
      FROM public.cliente_produto_modulos c
     WHERE c.oem_modulo_codigo IS NOT NULL
     GROUP BY c.modulo_id, c.oem_modulo_codigo
     ORDER BY c.modulo_id, count(*) DESC, c.oem_modulo_codigo
  )
  UPDATE public.produto_modulos m
     SET oem_modulo_codigo = voto.oem_modulo_codigo,
         updated_at = now()
    FROM voto
   WHERE m.id = voto.modulo_id
     AND m.oem_modulo_codigo IS DISTINCT FROM voto.oem_modulo_codigo;
  GET DIAGNOSTICS v_por_ficha = ROW_COUNT;

  UPDATE public.produto_modulos m
     SET oem_modulo_codigo = (regexp_match(m.descricao, 'módulo #([0-9]+)'))[1]::int,
         updated_at = now()
   WHERE m.oem_modulo_codigo IS NULL
     AND m.descricao ~ 'módulo #[0-9]+';
  GET DIAGNOSTICS v_por_descricao = ROW_COUNT;

  RAISE NOTICE 'oem_modulo_codigo: % pela ficha, % pela descricao', v_por_ficha, v_por_descricao;
END
$backfill$;

-- ============================================================================
-- O espelho passa a gravar o código também no catálogo, para o módulo criado
-- daqui em diante já nascer casável.
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
          (tenant_id, produto_id, nome, descricao, ativo, vlr_custo,
           margem_percentual, vlr_venda, oem_modulo_codigo)
        VALUES
          (v_cp.tenant_id, v_cp.produto_id, v_m.nome,
           'Importado do OEM · módulo #' || coalesce(v_m.codigo, 0), true, v_m.valor,
           0, 0, v_m.codigo)
        RETURNING id INTO v_modulo_id;
        v_criados_catalogo := v_criados_catalogo + 1;
      ELSE
        -- Módulo que já existia no catálogo e ainda não tinha o código: é a
        -- carga do espelho que sabe qual é.
        UPDATE public.produto_modulos
           SET oem_modulo_codigo = v_m.codigo, updated_at = now()
         WHERE id = v_modulo_id
           AND oem_modulo_codigo IS NULL
           AND v_m.codigo IS NOT NULL;
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
