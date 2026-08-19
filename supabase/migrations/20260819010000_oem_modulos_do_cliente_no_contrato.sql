-- ============================================================================
-- Os módulos que o cliente tem NO OEM passam a constar no card Produtos &
-- Módulos da ficha, com quantidade e valor, e a se manter sozinhos.
--
-- O dado já estava espelhado: `oem_espelho_filial.modulos` guarda, por filial,
-- o array com nome, código, quantidade, valor unitário e situação de cada
-- módulo — é dele que sai o `custo_total` que a ficha já mostra. Faltava
-- transformar isso nas linhas de `cliente_produto_modulos` que a tela lê.
--
-- DUAS ARMADILHAS QUE DESENHAM ESTA MIGRATION, as duas na mesma tabela:
--
-- 1. `trg_valor_enfileirar_omie` enfileira alteração de contrato no Omie a cada
--    INSERT/UPDATE de módulo. Sem trava, uma carga do espelho (2.566 filiais,
--    a cada 6h) empurraria contrato de cliente real para o Omie sozinha.
-- 2. `fn_sync_produto_valores` reescreve `cliente_produtos.vlr_mensal` e
--    `vlr_custo` a partir da soma dos módulos ativos — ou seja, mexeria na
--    mensalidade do cliente, que é MRR.
--
-- As duas obedecem a `doctorsaas.skip_valor_sync`, e é com ela ligada que a
-- sincronização roda: o espelho MOSTRA o que o parceiro cobra, não vende nada.
-- Nenhum valor de produto muda, nada vai para o Omie.
--
-- Os módulos espelhados entram com `vlr_mensal = 0` (o OEM cobra custo, não
-- receita) e ficam marcados com `origem = 'oem'`. Essa marca é o que permite a
-- sincronização mexer só no que ela mesma criou — módulo digitado à mão nunca
-- é tocado — e desfazer tudo com um DELETE, se um dia for preciso.
-- ============================================================================

ALTER TABLE public.cliente_produto_modulos
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN public.cliente_produto_modulos.origem IS
  'manual = digitado na ficha; oem = espelhado de oem_espelho_filial.modulos e mantido por fn_oem_espelhar_modulos_no_contrato.';

CREATE INDEX IF NOT EXISTS idx_cliente_produto_modulos_origem
  ON public.cliente_produto_modulos (cliente_produto_id, origem);

-- ============================================================================
-- Reconcilia os módulos de UMA filial do OEM nos produtos do cliente que a
-- tenham vinculada (`cliente_produtos.oem_codigo_filial`).
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

    -- Módulo que saiu da licença (ou foi desativado no OEM) sai de circulação
    -- na ficha. Inativa, não apaga: `movimentos_mrr` referencia estas linhas, e
    -- apagar levaria o histórico junto.
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
-- O gatilho: a cada carga do espelho, a filial cuja lista MUDOU reconcilia.
-- A comparação evita 2.566 reconciliações a cada 6 horas por nada.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_oem_espelhar_modulos() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.modulos IS NOT DISTINCT FROM OLD.modulos THEN
    RETURN NULL;
  END IF;
  PERFORM public.fn_oem_espelhar_modulos_no_contrato(NEW.tenant_id, NEW.filial_codigo, NEW.modulos);
  RETURN NULL;
END;
$trg$;

ALTER FUNCTION public.trg_oem_espelhar_modulos() OWNER TO postgres;

DROP TRIGGER IF EXISTS trg_oem_espelhar_modulos ON public.oem_espelho_filial;
CREATE TRIGGER trg_oem_espelhar_modulos
  AFTER INSERT OR UPDATE ON public.oem_espelho_filial
  FOR EACH ROW EXECUTE FUNCTION public.trg_oem_espelhar_modulos();

-- ============================================================================
-- Carga inicial: sem ela, o cliente só veria os módulos quando algo mudasse no
-- OEM — e cliente estável poderia ficar meses com a ficha vazia.
-- Restrita às filiais que têm produto vinculado; as outras não têm onde gravar.
-- ============================================================================
SELECT public.fn_oem_espelhar_modulos_no_contrato(f.tenant_id, f.filial_codigo, f.modulos)
  FROM public.oem_espelho_filial f
 WHERE f.modulos IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.cliente_produtos cp
      WHERE cp.tenant_id = f.tenant_id
        AND cp.oem_codigo_filial = f.filial_codigo
   );
