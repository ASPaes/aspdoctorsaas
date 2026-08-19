-- ============================================================================
-- Módulo espelhado que SAI da licença passa a ser APAGADO quando ninguém o
-- referencia, em vez de ficar como "Inativo" na ficha.
--
-- O caso que motivou: o OEM manda um módulo "Desconto" valendo R$ 0,00 em
-- várias licenças. Linha sem valor nenhum na ficha do cliente não é
-- informação — é ruído. A correção de origem está no DoctorOEM
-- (`oem-sync-passo` deixou de exportar "Desconto" zerado), mas sem esta
-- mudança a linha só trocaria de "Ativo" para "Inativo" e continuaria na tela.
--
-- Apagar continua sendo o caminho de exceção, não o padrão: só sai a linha que
-- a própria sincronização criou (`origem = 'oem'`) E que nenhum movimento de
-- MRR referencia. O que tem histórico continua sendo apenas inativado — é a
-- única FK que aponta para cá (`movimentos_mrr.cliente_produto_modulo_id`).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oem_espelhar_modulos_no_contrato(
  p_tenant_id      uuid,
  p_filial_codigo  text,
  p_modulos        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  -- A trava das duas armadilhas do cabeçalho. `true` no terceiro argumento =
  -- vale só nesta transação.
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  -- Só módulo ATIVO no OEM entra: desativado não cobra, e listar o que não
  -- cobra na ficha do cliente faz a soma não fechar com o custo da licença.
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
             coalesce(x.valor_unitario, 0)     AS valor
        FROM jsonb_to_recordset(p_modulos)
             AS x(nome text, codigo int, ativo boolean,
                  quantidade numeric, valor_unitario numeric)
       WHERE coalesce(x.ativo, true) = true
         AND coalesce(btrim(x.nome), '') <> ''
       ORDER BY public.fn_norm_nome_modulo(x.nome), x.codigo
    LOOP
      -- O módulo do cliente aponta para o catálogo do produto (FK). Se o nome
      -- não existe lá, cria: sem isso o módulo que o cliente paga simplesmente
      -- não teria como ser mostrado.
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
         SET quantidade      = v_m.quantidade,
             vlr_custo       = v_m.valor,
             ativo           = true,
             data_inativacao = NULL,
             updated_at      = now()
       WHERE c.cliente_produto_id = v_cp.id
         AND c.modulo_id = v_modulo_id
         AND c.origem = 'oem';
      GET DIAGNOSTICS v_n = ROW_COUNT;

      IF v_n > 0 THEN
        v_atualizados := v_atualizados + v_n;
      ELSIF NOT EXISTS (
        -- Linha digitada à mão para o mesmo módulo manda: a sincronização não
        -- duplica nem sobrescreve o que uma pessoa cadastrou.
        SELECT 1 FROM public.cliente_produto_modulos c
         WHERE c.cliente_produto_id = v_cp.id AND c.modulo_id = v_modulo_id
      ) THEN
        INSERT INTO public.cliente_produto_modulos
          (tenant_id, cliente_produto_id, modulo_id, quantidade,
           vlr_custo, vlr_mensal, ativo, origem, data_ativacao)
        VALUES
          (v_cp.tenant_id, v_cp.id, v_modulo_id, v_m.quantidade,
           v_m.valor, 0, true, 'oem', current_date);
        v_vinculados := v_vinculados + 1;
      END IF;
    END LOOP;

    -- Módulo que saiu da licença some da ficha quando ninguém o referencia:
    -- linha "Inativo" que nunca foi vendida só ocupa espaço e faz duvidar do
    -- que o cliente tem. Só o que a sincronização criou é candidato.
    DELETE FROM public.cliente_produto_modulos c
     USING public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)))
       AND NOT EXISTS (
         SELECT 1 FROM public.movimentos_mrr mv WHERE mv.cliente_produto_modulo_id = c.id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_apagados := v_apagados + v_n;

    -- O que sobrou tem movimento de MRR apontando para ele: apagar levaria o
    -- histórico junto. Esse fica, inativado.
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
$fn$;

ALTER FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) TO service_role;

-- ============================================================================
-- Limpeza do que já entrou: as linhas "Desconto" valendo zero criadas pela
-- carga inicial. Sem isto elas só sairiam quando o OEM parasse de mandá-las E
-- a filial mudasse alguma outra coisa.
--
-- Tudo num DO por causa do `skip_valor_sync`: ele vale por TRANSAÇÃO, e no SQL
-- Editor cada statement solto é uma transação. Sem o bloco, o DELETE
-- recalcularia os valores do produto e enfileiraria contrato no Omie.
-- ============================================================================
DO $limpeza$
DECLARE
  v_modulos int;
  v_catalogo int;
BEGIN
  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  DELETE FROM public.cliente_produto_modulos c
   USING public.produto_modulos m
   WHERE m.id = c.modulo_id
     AND c.origem = 'oem'
     AND public.fn_norm_nome_modulo(m.nome) LIKE '%desconto%'
     AND coalesce(c.vlr_custo, 0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.movimentos_mrr mv WHERE mv.cliente_produto_modulo_id = c.id
     );
  GET DIAGNOSTICS v_modulos = ROW_COUNT;

  -- O "Desconto" que a sincronização criou no catálogo do produto também sai,
  -- desde que ninguém o use — inclusive as outras duas tabelas que apontam
  -- para produto_modulos (contrato e jornada de implantação).
  DELETE FROM public.produto_modulos m
   WHERE public.fn_norm_nome_modulo(m.nome) LIKE '%desconto%'
     AND m.descricao LIKE 'Importado do OEM%'
     AND NOT EXISTS (SELECT 1 FROM public.cliente_produto_modulos c WHERE c.modulo_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.contrato_itens ci WHERE ci.modulo_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_journey_modules j WHERE j.produto_modulo_id = m.id);
  GET DIAGNOSTICS v_catalogo = ROW_COUNT;

  RAISE NOTICE 'Desconto zerado removido: % linha(s) de cliente, % do catálogo.', v_modulos, v_catalogo;
END;
$limpeza$;
