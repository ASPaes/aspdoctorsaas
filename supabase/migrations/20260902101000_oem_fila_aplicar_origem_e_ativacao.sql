-- ⚠️ SUPERSEDIDA EM PARTE por 20260903093000_movimento_ativacao_nunca_nula.sql:
--    o `nullif` da ativacao no movimento de MRR quebrava a constraint NOT NULL.
-- ============================================================================
-- `fn_oem_fila_aplicar`: três acertos para a fila poder receber a calculadora.
--
-- 1. ORIGEM DA LINHA vem do payload. Hoje é `'oem'` cravado. Com o intake
--    passando a enfileirar, um módulo vendido pela calculadora nasceria com
--    origem 'oem' e o histórico diria "Sincronização OEM" para uma venda —
--    pior que o traço em branco de hoje, porque afirma algo falso.
--
-- 2. FONTE carimbada num GUC antes de aplicar. `usuario_id` da linha é NULL
--    quando quem pediu foi uma integração; sem um segundo carimbo não há como
--    o histórico distinguir "a máquina copiou o espelho" de "veio uma venda".
--    Quem lê esse GUC é a migration do passo 3; setá-lo aqui é inofensivo até lá.
--
-- 3. ATIVAÇÃO no movimento de MRR. `movimentos_mrr.vlr_ativacao` é o que
--    alimenta o KPI "Receita de Ativação" do dashboard; o `vlr_ativacao` da
--    LINHA do módulo alimenta outra coisa (o total do contrato, via
--    `fn_ativacao_dos_modulos` → `contrato_itens`). Hoje a fila só grava na
--    linha, então setup de up-sell nunca entrava na receita de ativação do mês.
--    Não há dupla contagem: `receitaAtivacao` soma `movimentos_mrr.vlr_ativacao`
--    mais a ativação de clientes NOVOS, nunca a dos módulos.
--
--    ⚠️ A regra de qual chave usar não é cosmética:
--      'ativar'     → `vlr_ativacao`        (a linha nasce agora; a cobrança é dela)
--      'quantidade' → `vlr_ativacao_somar`  (só o botão de adicionar manda; o
--                     lápis grava `vlr_ativacao` direto na linha e usá-lo aqui
--                     transformaria a ativação antiga em receita de novo)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oem_fila_aplicar(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_l        public.oem_sync_fila;
  v_mod      public.cliente_produto_modulos;
  v_cliente  uuid;
  v_nome     text;
  v_antes    numeric;
  v_delta    numeric;
  v_mensal   numeric;
  v_ativ     numeric := 0;
  v_origem   text;
  v_dos_mod  boolean;
  v_novo     uuid;
  v_mov      uuid;
  v_res      jsonb;
BEGIN
  SELECT * INTO v_l FROM public.oem_sync_fila WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linha da fila não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Quem pediu isto foi gente, na ficha do cliente; o cron e a edge function só
  -- entregam o recado. Sem este carimbo, tudo o que a linha escrever daqui para
  -- baixo — histórico de módulos, cancelado_por — nasce órfão, porque
  -- service_role não tem auth.uid(). Vale só nesta transação.
  IF v_l.usuario_id IS NOT NULL THEN
    PERFORM set_config('doctorsaas.acting_user', v_l.usuario_id::text, true);
  END IF;

  -- Pedido sem gente por trás não é necessariamente da máquina: pode ser uma
  -- venda que chegou por integração. A fonte diz qual das duas.
  IF nullif(v_l.payload->>'fonte', '') IS NOT NULL THEN
    PERFORM set_config('doctorsaas.acting_source', v_l.payload->>'fonte', true);
  END IF;

  SELECT cp.cliente_id INTO v_cliente
    FROM public.cliente_produtos cp WHERE cp.id = v_l.cliente_produto_id;
  SELECT pm.nome INTO v_nome
    FROM public.produto_modulos pm WHERE pm.id = v_l.modulo_catalogo_id;

  v_dos_mod := public.fn_receita_vem_dos_modulos(v_l.cliente_produto_id);
  v_mensal  := coalesce(nullif(v_l.payload->>'vlr_mensal', '')::numeric, 0);
  v_origem  := coalesce(nullif(v_l.payload->>'origem', ''), 'oem');

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
    v_ativ  := coalesce(nullif(v_l.payload->>'vlr_ativacao_somar', '')::numeric, 0);

    UPDATE public.cliente_produto_modulos
       SET quantidade        = v_l.quantidade,
           quantidade_manual = v_l.quantidade,
           -- 22/08/2026: ativação digitada ao SOMAR quantidade é cobrança nova,
           -- então soma na linha em vez de ser descartada. Só o botão de
           -- adicionar manda `vlr_ativacao_somar`; a edição pelo lápis grava o
           -- valor direto na linha e não pode somar de novo.
           vlr_ativacao      = coalesce(vlr_ativacao, 0) + v_ativ,
           updated_at        = now()
     WHERE id = v_l.modulo_linha_id;

    v_res := jsonb_build_object('quantidade_antes', v_antes, 'quantidade_depois', v_l.quantidade);
    v_novo := v_l.modulo_linha_id;

  ELSIF v_l.acao = 'ativar' THEN
    IF v_l.modulo_catalogo_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo do catálogo');
    END IF;
    v_ativ := coalesce(nullif(v_l.payload->>'vlr_ativacao', '')::numeric, 0);

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
        v_ativ,
        nullif(v_l.payload->>'data_ativacao', '')::date,
        nullif(v_l.payload->>'data_venda', '')::date,
        nullif(v_l.payload->>'funcionario_id', '')::bigint,
        nullif(v_l.payload->>'origem_venda_id', '')::bigint,
        true, v_origem, v_l.oem_modulo_codigo
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
      valor_delta, custo_delta, vlr_ativacao, descricao,
      cliente_produto_modulo_id, funcionario_id, origem_venda, status
    ) VALUES (
      v_l.tenant_id, v_cliente, 'upsell',
      -- A data é a da VENDA, não a da aprovação: um pedido aprovado três dias
      -- depois continua pertencendo ao mês em que foi vendido.
      coalesce(nullif(v_l.payload->>'data_venda', '')::date, current_date),
      v_mensal * v_delta,
      coalesce(nullif(v_l.payload->>'vlr_custo', '')::numeric, 0) * v_delta,
      nullif(v_ativ, 0),
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

ALTER FUNCTION public.fn_oem_fila_aplicar(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_aplicar(uuid) TO service_role;
