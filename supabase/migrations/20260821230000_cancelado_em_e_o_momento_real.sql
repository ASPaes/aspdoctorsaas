-- ============================================================================
-- `cancelado_em` passa a guardar QUANDO FOI REGISTRADO, não a data de vigência.
--
-- São duas informações diferentes e estavam na mesma coluna:
--   data_inativacao -> a partir de quando o cancelamento vale (o operador escolhe)
--   cancelado_em    -> quando alguém registrou isso (auditoria)
--
-- Como `cancelado_em` recebia a data escolhida à meia-noite, todo cancelamento
-- aparecia com horário 00:00 — e a ficha não tinha como mostrar "cancelado em
-- 21/08 às 15:42", que é o que a tela precisa dizer. Pior: num lançamento
-- retroativo as duas coisas divergem de verdade, e a auditoria perdia o rastro
-- de quando a decisão foi tomada.
--
-- Só muda o registro novo. O que já está gravado permanece — reescrever
-- histórico para "arrumar" o formato seria inventar um horário que ninguém
-- observou.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_cancelar_modulo_aplicar(
  p_id         uuid,
  p_quantidade numeric DEFAULT NULL,
  p_motivo     text    DEFAULT NULL,
  p_motivo_id  bigint  DEFAULT NULL,
  p_data       date    DEFAULT NULL
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
           data_inativacao        = v_data,       -- a partir de quando vale
           cancelado_manual       = true,
           cancelamento_motivo    = v_motivo,
           motivo_cancelamento_id = p_motivo_id,
           cancelado_em           = now(),        -- quando foi registrado
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

  -- O downsell continua nascendo aqui, e continua só quando a receita NÃO vem
  -- dos módulos: vindo, o gatilho de sincronia já baixou o valor do produto.
  v_mensal := coalesce(v_row.vlr_mensal, 0) * v_cancel;

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
    'receita_dos_modulos', v_dos_mod
  );
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) FROM anon;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date) TO service_role;
