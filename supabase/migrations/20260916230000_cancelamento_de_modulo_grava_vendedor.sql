-- Cancelamento de módulo grava o vendedor no downsell.
--
-- O upsell do módulo nasce com funcionario_id (vendedor do diálogo de adicionar);
-- o downsell do cancelamento nascia sem, e a coluna Funcionário de Movimentos de
-- MRR mostrava "-". A tela passa a mandar o vendedor (pré-preenchido com o do
-- módulo) e, sem ele, a função usa o vendedor gravado na linha do módulo.
--
-- Caminhos que chegam aqui:
--   * sem licença OEM: fn_cancelar_modulo_cliente (tela) -> p_funcionario_id
--   * com licença OEM: payload.funcionario_id na fila -> fn_oem_fila_aplicar
--     (pedidos já enfileirados sem a chave caem no vendedor do módulo)
--   * intake/calculadora: chama com 6 args -> vendedor do módulo
--
-- Parâmetro novo muda a assinatura: DROP das versões de 6 args antes, senão
-- ficam duas sobrecargas e a chamada posicional de 6 args fica ambígua.
-- Corpos copiados de produção (db dump de 16/09/2026), alteração mínima.

BEGIN;

DROP FUNCTION public.fn_cancelar_modulo_cliente("p_id" "uuid", "p_quantidade" numeric, "p_motivo" "text", "p_motivo_id" bigint, "p_data" "date", "p_valor_downsell" numeric);
DROP FUNCTION public.fn_cancelar_modulo_aplicar("p_id" "uuid", "p_quantidade" numeric, "p_motivo" "text", "p_motivo_id" bigint, "p_data" "date", "p_valor_downsell" numeric);

CREATE OR REPLACE FUNCTION "public"."fn_cancelar_modulo_aplicar"("p_id" "uuid", "p_quantidade" numeric DEFAULT NULL::numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_motivo_id" bigint DEFAULT NULL::bigint, "p_data" "date" DEFAULT NULL::"date", "p_valor_downsell" numeric DEFAULT NULL::numeric, "p_funcionario_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row      public.cliente_produto_modulos;
  v_atual    numeric;
  v_cancel   numeric;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_data     date := coalesce(p_data, current_date);
  v_dos_mod  boolean;
  v_cliente  uuid;
  v_nome     text;
  v_mensal   numeric;
  v_custo    numeric;
  v_mov      uuid;
  v_res      jsonb;
  v_vendedor bigint;
BEGIN
  SELECT * INTO v_row FROM public.cliente_produto_modulos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.ativo = false THEN
    RAISE EXCEPTION 'Este módulo já está cancelado.' USING ERRCODE = '22023';
  END IF;

  IF p_motivo_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.motivos_cancelamento m
     WHERE m.id = p_motivo_id
       AND (m.tenant_id IS NULL OR m.tenant_id = v_row.tenant_id)
  ) THEN
    RAISE EXCEPTION 'Motivo de cancelamento inválido para este cliente.' USING ERRCODE = '23503';
  END IF;

  v_atual  := greatest(coalesce(v_row.quantidade, 1), 1);
  v_cancel := least(greatest(coalesce(p_quantidade, v_atual), 1), v_atual);

  v_dos_mod := public.fn_receita_vem_dos_modulos(v_row.cliente_produto_id);

  SELECT cp.cliente_id INTO v_cliente
    FROM public.cliente_produtos cp WHERE cp.id = v_row.cliente_produto_id;
  SELECT pm.nome INTO v_nome
    FROM public.produto_modulos pm WHERE pm.id = v_row.modulo_id;

  IF v_cancel >= v_atual THEN
    UPDATE public.cliente_produto_modulos
       SET ativo                  = false,
           data_inativacao        = v_data,
           cancelado_manual       = true,
           cancelamento_motivo    = v_motivo,
           motivo_cancelamento_id = p_motivo_id,
           cancelado_em           = now(),
           cancelado_por          = coalesce(public.fn_acting_user(), v_row.cancelado_por),
           updated_at             = now()
     WHERE id = p_id;

    v_res := jsonb_build_object('cancelado', true, 'parcial', false,
                                'quantidade', v_cancel, 'data', v_data);
  ELSE
    UPDATE public.cliente_produto_modulos
       SET quantidade             = v_atual - v_cancel,
           quantidade_manual      = v_atual - v_cancel,
           cancelamento_motivo    = v_motivo,
           motivo_cancelamento_id = p_motivo_id,
           cancelado_em           = now(),
           cancelado_por          = coalesce(public.fn_acting_user(), v_row.cancelado_por),
           updated_at             = now()
     WHERE id = p_id;

    v_res := jsonb_build_object('cancelado', true, 'parcial', true,
                                'quantidade', v_cancel, 'restante', v_atual - v_cancel,
                                'data', v_data);
  END IF;

  -- O valor que sai do MRR. Informado pela tela quando ela sabe mais que a
  -- linha — que é o caso sempre que a venda virou movimento em vez de preço.
  -- Sem informação, cai na conta de antes.
  v_mensal := coalesce(p_valor_downsell, coalesce(v_row.vlr_mensal, 0) * v_cancel);

  IF NOT v_dos_mod AND v_mensal > 0 AND v_cliente IS NOT NULL THEN
    v_custo := CASE
                 WHEN v_row.vlr_custo_total IS NOT NULL AND v_atual > 0
                   THEN round(v_row.vlr_custo_total * (v_cancel / v_atual), 2)
                 ELSE coalesce(v_row.vlr_custo, 0) * v_cancel
               END;

    -- Quem responde pela perda é o vendedor que a tela mandou; sem ele, o que
    -- vendeu o módulo. Mesmo dono do upsell que o módulo gerou ao entrar.
    v_vendedor := coalesce(p_funcionario_id, v_row.funcionario_id);

    INSERT INTO public.movimentos_mrr (
      tenant_id, cliente_id, tipo, data_movimento,
      valor_delta, custo_delta, descricao,
      cliente_produto_modulo_id, funcionario_id, status
    ) VALUES (
      v_row.tenant_id, v_cliente, 'downsell', v_data,
      -v_mensal, -coalesce(v_custo, 0),
      CASE WHEN v_cancel > 1
           THEN format('Cancelamento de %s %s', v_cancel::text, coalesce(v_nome, 'módulo'))
           ELSE format('Cancelamento de %s', coalesce(v_nome, 'módulo')) END
        || coalesce(' · ' || v_motivo, ''),
      p_id, v_vendedor, 'ativo'
    )
    RETURNING id INTO v_mov;
  END IF;

  RETURN v_res || jsonb_build_object(
    'movimento_mrr', v_mov,
    'valor_downsell', v_mensal,
    'receita_dos_modulos', v_dos_mod,
    'funcionario_id', v_vendedor
  );
END;
$$;

ALTER FUNCTION "public"."fn_cancelar_modulo_aplicar"("p_id" "uuid", "p_quantidade" numeric, "p_motivo" "text", "p_motivo_id" bigint, "p_data" "date", "p_valor_downsell" numeric, "p_funcionario_id" bigint) OWNER TO "postgres";
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric, bigint) TO service_role;

CREATE OR REPLACE FUNCTION "public"."fn_cancelar_modulo_cliente"("p_id" "uuid", "p_quantidade" numeric DEFAULT NULL::numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_motivo_id" bigint DEFAULT NULL::bigint, "p_data" "date" DEFAULT NULL::"date", "p_valor_downsell" numeric DEFAULT NULL::numeric, "p_funcionario_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.cliente_produto_modulos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  RETURN public.fn_cancelar_modulo_aplicar(
    p_id, p_quantidade, p_motivo, p_motivo_id, p_data, p_valor_downsell, p_funcionario_id);
END;
$$;

ALTER FUNCTION "public"."fn_cancelar_modulo_cliente"("p_id" "uuid", "p_quantidade" numeric, "p_motivo" "text", "p_motivo_id" bigint, "p_data" "date", "p_valor_downsell" numeric, "p_funcionario_id" bigint) OWNER TO "postgres";
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date, numeric, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date, numeric, bigint) TO authenticated, service_role;

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
  v_ativ     numeric := 0;
  v_custo    numeric;
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

  -- Quem digita na tela ja manda o custo no payload (o dialogo preenche o campo
  -- com o preco do parceiro). Quem chega por integracao nao manda, e gravar zero
  -- deixa a ficha dizendo que o modulo e de graca. O fallback pergunta ao OEM.
  v_custo   := coalesce(
    nullif(v_l.payload->>'vlr_custo', '')::numeric,
    public.fn_oem_custo_do_modulo(v_l.tenant_id, v_l.cliente_produto_id, v_l.oem_modulo_codigo),
    0);

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
      nullif(v_l.payload->>'valor_downsell', '')::numeric,
      nullif(v_l.payload->>'funcionario_id', '')::bigint
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
        v_custo,
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
      v_custo * v_delta,
      coalesce(v_ativ, 0),
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

COMMIT;
