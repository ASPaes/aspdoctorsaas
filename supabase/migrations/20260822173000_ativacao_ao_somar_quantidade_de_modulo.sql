-- 22/08/2026 — a ativação digitada ao SOMAR quantidade parava de ser descartada.
--
-- Complementa 20260822170000_ativacao_do_modulo_vai_para_o_faturamento.sql, que
-- levou o Valor Ativação do módulo para o contrato. Faltava um caso: quando o
-- cliente JÁ tem o módulo, o botão de adicionar não cria linha nova — soma na
-- quantidade — e tanto o caminho manual quanto esta função só atualizavam
-- `quantidade`. O valor digitado no campo sumia sem aviso.
--
-- POR QUE UM SINALIZADOR NOVO NO PAYLOAD (`vlr_ativacao_somar`) e não o
-- `vlr_ativacao` que já vai lá: `acao='quantidade'` tem DOIS produtores.
--   * o botão Adicionar Módulo, quando o módulo já existe -> é cobrança nova,
--     tem que somar;
--   * o lápis (editar), quando a quantidade muda -> esse já grava `vlr_ativacao`
--     direto na linha antes de enfileirar. Somar de novo aqui dobraria o valor.
-- Só o primeiro manda `vlr_ativacao_somar`. Sem payload da chave, nada muda —
-- que é exatamente o comportamento de hoje.
--
-- Corpo idêntico ao de produção (baixado hoje via `supabase db dump --linked`),
-- com esse único trecho alterado.
CREATE OR REPLACE FUNCTION "public"."fn_oem_fila_aplicar"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_l        public.oem_sync_fila;
  v_mod      public.cliente_produto_modulos;
  v_cliente  uuid;
  v_nome     text;
  v_antes    numeric;
  v_delta    numeric;
  v_mensal   numeric;
  v_dos_mod  boolean;
  v_novo     uuid;
  v_mov      uuid;
  v_res      jsonb;
BEGIN
  SELECT * INTO v_l FROM public.oem_sync_fila WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha da fila não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  SELECT cp.cliente_id INTO v_cliente
    FROM public.cliente_produtos cp WHERE cp.id = v_l.cliente_produto_id;
  SELECT pm.nome INTO v_nome
    FROM public.produto_modulos pm WHERE pm.id = v_l.modulo_catalogo_id;

  v_dos_mod := public.fn_receita_vem_dos_modulos(v_l.cliente_produto_id);
  v_mensal  := coalesce(nullif(v_l.payload->>'vlr_mensal', '')::numeric, 0);

  IF v_l.acao = 'cancelar' THEN
    IF v_l.modulo_linha_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo');
    END IF;
    IF EXISTS (SELECT 1 FROM public.cliente_produto_modulos
                WHERE id = v_l.modulo_linha_id AND ativo = false) THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'módulo já estava cancelado');
    END IF;
    v_res := public.fn_cancelar_modulo_aplicar(
      v_l.modulo_linha_id,
      nullif(v_l.payload->>'quantidade_cancelar', '')::numeric,
      v_l.payload->>'motivo',
      nullif(v_l.payload->>'motivo_id', '')::bigint,
      nullif(v_l.payload->>'data', '')::date,
      nullif(v_l.payload->>'valor_downsell', '')::numeric
    );
    RETURN jsonb_build_object('aplicado', true, 'ficha', v_res);
  END IF;

  IF v_l.acao = 'quantidade' THEN
    SELECT * INTO v_mod FROM public.cliente_produto_modulos WHERE id = v_l.modulo_linha_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha da ficha não existe mais');
    END IF;
    v_antes := greatest(coalesce(v_mod.quantidade, 1), 1);
    v_delta := coalesce(v_l.quantidade, v_antes) - v_antes;

    UPDATE public.cliente_produto_modulos
       SET quantidade        = v_l.quantidade,
           quantidade_manual = v_l.quantidade,
           -- 22/08/2026: ativação digitada ao SOMAR quantidade é cobrança nova,
           -- então soma na linha em vez de ser descartada. Só o botão de
           -- adicionar manda `vlr_ativacao_somar`; a edição pelo lápis grava o
           -- valor direto na linha e não pode somar de novo.
           vlr_ativacao      = coalesce(vlr_ativacao, 0)
                               + coalesce(nullif(v_l.payload->>'vlr_ativacao_somar', '')::numeric, 0),
           updated_at        = now()
     WHERE id = v_l.modulo_linha_id;

    v_res := jsonb_build_object('quantidade_antes', v_antes, 'quantidade_depois', v_l.quantidade);
    v_novo := v_l.modulo_linha_id;

  ELSIF v_l.acao = 'ativar' THEN
    IF v_l.modulo_catalogo_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo do catálogo');
    END IF;
    SELECT id INTO v_novo FROM public.cliente_produto_modulos
     WHERE cliente_produto_id = v_l.cliente_produto_id
       AND modulo_id = v_l.modulo_catalogo_id
       AND ativo = true
     LIMIT 1;

    IF v_novo IS NULL THEN
      INSERT INTO public.cliente_produto_modulos (
        tenant_id, cliente_produto_id, modulo_id, quantidade,
        vlr_mensal, vlr_custo, vlr_ativacao, data_ativacao,
        data_venda, funcionario_id, origem_venda_id,
        ativo, origem, oem_modulo_codigo
      ) VALUES (
        v_l.tenant_id, v_l.cliente_produto_id, v_l.modulo_catalogo_id,
        greatest(coalesce(v_l.quantidade, 1), 1),
        v_mensal,
        coalesce(nullif(v_l.payload->>'vlr_custo', '')::numeric, 0),
        coalesce(nullif(v_l.payload->>'vlr_ativacao', '')::numeric, 0),
        nullif(v_l.payload->>'data_ativacao', '')::date,
        nullif(v_l.payload->>'data_venda', '')::date,
        nullif(v_l.payload->>'funcionario_id', '')::bigint,
        nullif(v_l.payload->>'origem_venda_id', '')::bigint,
        true, 'oem', v_l.oem_modulo_codigo
      )
      RETURNING id INTO v_novo;
    END IF;

    v_delta := greatest(coalesce(v_l.quantidade, 1), 1);
    v_res := jsonb_build_object('modulo_criado', v_novo, 'quantidade', v_l.quantidade);

    UPDATE public.oem_sync_fila SET modulo_linha_id = v_novo WHERE id = p_id;
  ELSE
    RETURN jsonb_build_object('aplicado', false, 'motivo', 'ação sem efeito na ficha');
  END IF;

  IF NOT v_dos_mod AND v_mensal > 0 AND coalesce(v_delta, 0) > 0 AND v_cliente IS NOT NULL THEN
    INSERT INTO public.movimentos_mrr (
      tenant_id, cliente_id, tipo, data_movimento,
      valor_delta, custo_delta, descricao,
      cliente_produto_modulo_id, funcionario_id, origem_venda, status
    ) VALUES (
      v_l.tenant_id, v_cliente, 'upsell',
      coalesce(nullif(v_l.payload->>'data_venda', '')::date, current_date),
      v_mensal * v_delta,
      coalesce(nullif(v_l.payload->>'vlr_custo', '')::numeric, 0) * v_delta,
      CASE WHEN v_delta > 1
           THEN format('Adição de %s %s', v_delta::text, coalesce(v_nome, 'módulo'))
           ELSE format('Adição de %s', coalesce(v_nome, 'módulo')) END,
      v_novo,
      nullif(v_l.payload->>'funcionario_id', '')::bigint,
      nullif(v_l.payload->>'origem_venda', ''),
      'ativo'
    )
    RETURNING id INTO v_mov;
  END IF;

  RETURN jsonb_build_object('aplicado', true, 'ficha', v_res, 'movimento_mrr', v_mov);
END;
$$;
