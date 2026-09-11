-- ============================================================================
-- O espelho de módulos do OEM volta a gravar quantidade mínima 1.
--
-- O QUE QUEBROU
--
-- 20260907020000 trocou `greatest(coalesce(x.quantidade, 1), 1)` por
-- `coalesce(x.quantidade, 1)`, para a ficha mostrar 0 quando o OEM diz 0.
-- Só que `cliente_produto_modulos` tem `CHECK (quantidade >= 1)`, e a
-- migration não mexeu nele. Desde 07/09/2026:
--
--   - Vincular pela primeira vez qualquer filial com um módulo em quantidade 0
--     QUEBRA: o vínculo grava o código, o gatilho do espelho tenta inserir o
--     módulo com 0 e o banco recusa. O erro sobe cru até a tela ("violates
--     check constraint cliente_produto_modulos_quantidade_check"). Medido em
--     10/09/2026: 691 módulos em 564 filiais do espelho estão assim.
--   - As 12 correções que ela prometia nunca entraram: o UPDATE bate na mesma
--     regra. Não estourou antes só porque o espelho só reprocessa uma filial
--     quando os módulos dela mudam.
--
-- Achado na prévia dos casos de segunda loja (10/09/2026): a ALENTO SORVETES
-- tem o módulo "Gestao" com quantidade 0 e custo R$ 29,90, e a gravação parou.
--
-- POR QUE O PISO, E NÃO SOLTAR A REGRA DO BANCO
--
-- Aceitar 0 na coluna é o que 07/09 queria, mas a coluna é lida por 18
-- funções, entre elas a fila que ESCREVE quantidade no parceiro OEM
-- (calculadora, aprovação, aplicação) e a importação de módulos da
-- integração Hiper. Mudar o que esses caminhos podem receber pede revisão
-- caminho por caminho. O piso é como o espelho funcionou por meses.
--
-- O dinheiro não muda: o custo sai de `coalesce(vlr_custo_total, vlr_custo *
-- quantidade)`, e o piso só pesaria num módulo com quantidade 0 SEM valor
-- total. Medido em 10/09/2026: dos 691 módulos com quantidade 0 no espelho,
-- nenhum vem sem valor total. Custo que o piso inventaria: R$ 0,00. O que
-- volta é só o efeito visual que 07/09 quis corrigir e nunca corrigiu: a
-- ficha mostra 1 onde o OEM diz 0.
--
-- Cópia fiel da versão em produção (lida em 10/09/2026, md5 do corpo
-- 1d903200adac60f6a0c0f1e5d27e3a91). A única mudança é a expressão da
-- quantidade.
-- ============================================================================

create or replace function public.fn_oem_espelhar_modulos_no_contrato(
  p_tenant_id uuid, p_filial_codigo text, p_modulos jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
             -- Mínimo 1 de novo (ver cabeçalho de 20260910230000): a coluna
             -- tem CHECK (quantidade >= 1), e gravar o 0 do OEM quebrava o
             -- vínculo de 564 filiais. O custo não depende disto: sai do
             -- valor_total que o OEM manda.
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
$function$;
