-- ============================================================================
-- O downsell do cancelamento passa a ser informado, e a tela mostra por quê.
--
-- O problema, achado no CAMPINA VERDE em 21/08/2026: uma unidade de Usuário
-- Cloud foi vendida por R$ 1,00, mas esse R$ 1,00 nunca ficou na linha do
-- módulo — ele existe SÓ como movimento de MRR. A linha tem vlr_mensal = 0
-- para as três unidades. No cancelamento a conta deu `0 × 1 = 0` e nenhum
-- downsell foi gerado, enquanto o upsell de R$ 1,00 continuou contando para
-- uma unidade que não existe mais.
--
-- É o mesmo padrão já documentado para o reajuste: o valor existe apenas no
-- movimento. E não dá para deduzir qual unidade foi vendida por quanto — o
-- modelo é uma linha, uma quantidade, um preço para todas.
--
-- Então quem decide é quem cancela. O banco passa a saber DIZER quanto o
-- módulo contribui hoje (fn_mrr_do_modulo) e a ACEITAR o valor que a tela
-- confirmar (p_valor_downsell). Sem valor informado, o comportamento é o de
-- antes: vlr_mensal × quantidade cancelada.
-- ============================================================================

-- ============================================================================
-- Quanto este módulo soma no MRR hoje: o que está na linha + os movimentos
-- vigentes amarrados a ela.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_mrr_do_modulo(p_modulo_linha_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     public.cliente_produto_modulos;
  v_linha   numeric;
  v_movs    numeric;
BEGIN
  SELECT * INTO v_row FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
       v_row.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  v_linha := coalesce(v_row.vlr_mensal, 0) * greatest(coalesce(v_row.quantidade, 1), 1);

  -- Mesma régua do saldo (fn_mrr_cliente_em): só movimento recorrente vigente,
  -- não estornado. Soma com sinal, então um downsell anterior já entra como
  -- desconto e o número não conta duas vezes a mesma baixa.
  SELECT coalesce(SUM(mv.valor_delta), 0) INTO v_movs
    FROM public.movimentos_mrr mv
   WHERE mv.cliente_produto_modulo_id = p_modulo_linha_id
     AND mv.tipo IN ('upsell','cross_sell','downsell','reajuste')
     AND mv.status = 'ativo'
     AND mv.estornado_por IS NULL
     AND mv.estorno_de IS NULL
     AND mv.encerrado_em IS NULL;

  RETURN jsonb_build_object(
    'quantidade',  greatest(coalesce(v_row.quantidade, 1), 1),
    'na_linha',    v_linha,
    'movimentos',  v_movs,
    'total',       v_linha + v_movs
  );
END;
$$;

ALTER FUNCTION public.fn_mrr_do_modulo(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_mrr_do_modulo(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_mrr_do_modulo(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_mrr_do_modulo(uuid) TO authenticated, service_role;

-- ============================================================================
-- O miolo do cancelamento aceita o valor do downsell.
-- Assinatura nova (6 argumentos), então é DROP + CREATE: CREATE OR REPLACE não
-- acrescenta parâmetro, criaria uma sobrecarga e as chamadas de 5 argumentos
-- ficariam ambíguas.
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date);

CREATE OR REPLACE FUNCTION public.fn_cancelar_modulo_aplicar(
  p_id             uuid,
  p_quantidade     numeric DEFAULT NULL,
  p_motivo         text    DEFAULT NULL,
  p_motivo_id      bigint  DEFAULT NULL,
  p_data           date    DEFAULT NULL,
  p_valor_downsell numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
           cancelado_por          = coalesce(auth.uid(), v_row.cancelado_por),
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
           cancelado_por          = coalesce(auth.uid(), v_row.cancelado_por),
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

    INSERT INTO public.movimentos_mrr (
      tenant_id, cliente_id, tipo, data_movimento,
      valor_delta, custo_delta, descricao,
      cliente_produto_modulo_id, status
    ) VALUES (
      v_row.tenant_id, v_cliente, 'downsell', v_data,
      -v_mensal, -coalesce(v_custo, 0),
      CASE WHEN v_cancel > 1
           THEN format('Cancelamento de %s %s', v_cancel::text, coalesce(v_nome, 'módulo'))
           ELSE format('Cancelamento de %s', coalesce(v_nome, 'módulo')) END
        || coalesce(' · ' || v_motivo, ''),
      p_id, 'ativo'
    )
    RETURNING id INTO v_mov;
  END IF;

  RETURN v_res || jsonb_build_object(
    'movimento_mrr', v_mov,
    'valor_downsell', v_mensal,
    'receita_dos_modulos', v_dos_mod
  );
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) FROM anon;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) TO service_role;

-- ============================================================================
-- A porta de quem clica repassa o valor.
-- ============================================================================
DROP FUNCTION IF EXISTS public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date);

CREATE OR REPLACE FUNCTION public.fn_cancelar_modulo_cliente(
  p_id             uuid,
  p_quantidade     numeric DEFAULT NULL,
  p_motivo         text    DEFAULT NULL,
  p_motivo_id      bigint  DEFAULT NULL,
  p_data           date    DEFAULT NULL,
  p_valor_downsell numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
    p_id, p_quantidade, p_motivo, p_motivo_id, p_data, p_valor_downsell);
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date, numeric) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text, bigint, date, numeric)
  TO authenticated, service_role;

-- ============================================================================
-- A fila leva o valor até o outro lado do aceite do parceiro.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_fila_aplicar(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
$fn$;

ALTER FUNCTION public.fn_oem_fila_aplicar(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_aplicar(uuid) TO service_role;
