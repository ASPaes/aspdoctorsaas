-- ============================================================================
-- Duas coisas que são a mesma coisa vista dos dois lados.
--
-- (1) A RECEITA DIGITADA NO PRODUTO ERA SOBRESCRITA POR UM MÓDULO PAGO.
--
-- fn_sync_produto_valores faz `vlr_mensal = soma dos módulos ativos`. Enquanto
-- todos valem zero ela preserva o que foi digitado — é o caso do OEM, onde a
-- receita é do produto e os módulos são a licença. Mas bastava UM módulo com
-- valor para ela trocar a receita inteira pela do módulo. Medido no container
-- local com o cenário real: produto de R$ 500,00 com 3 módulos zerados; alguém
-- acrescenta um módulo de R$ 50,00 e o produto passa a valer R$ 50,00.
--
-- Alcance: dos 766 produtos com módulos ativos em 21/08/2026, **763** estão
-- nessa configuração — praticamente todo cliente do OEM. Só 2 têm a receita nos
-- módulos e 1 está misturado.
--
-- A regra passa a ser explícita: a receita do produto só é a soma dos módulos
-- quando TODOS os módulos ativos têm valor. Havendo qualquer um zerado, quem
-- manda é o que foi digitado no produto, e o que se vendeu a mais entra no MRR
-- pelo movimento — que é o mecanismo desenhado para isso.
--
-- (2) CANCELAR MÓDULO NÃO GERAVA DOWNSELL NENHUM.
--
-- Adicionar módulo gerava upsell automático; cancelar não devolvia nada. O MRR
-- só subia. Nenhum cancelamento tinha acontecido ainda (conferido: 0 linhas),
-- então não há backfill — mas a partir do primeiro o erro seria acumulativo.
--
-- O downsell nasce dentro da fn_cancelar_modulo_aplicar, que é o ponto único
-- por onde todo cancelamento passa (tela, fila e cron), e SÓ quando a receita
-- não vem dos módulos — senão o gatilho acima já teria baixado o valor e o
-- movimento descontaria duas vezes.
-- ============================================================================

-- ============================================================================
-- Quem manda na receita deste produto: os módulos ou o que foi digitado?
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_receita_vem_dos_modulos(p_cliente_produto_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT count(*) > 0
        AND bool_and(coalesce(m.vlr_mensal, 0) > 0)
       FROM public.cliente_produto_modulos m
      WHERE m.cliente_produto_id = p_cliente_produto_id
        AND m.ativo = true),
    false);
$$;

COMMENT ON FUNCTION public.fn_receita_vem_dos_modulos(uuid) IS
  'true quando TODOS os módulos ativos do produto têm valor mensal — só nesse caso a receita do produto é a soma deles. Com qualquer módulo zerado (o caso do OEM), a receita é a digitada no produto e a venda nova entra por movimento de MRR.';

ALTER FUNCTION public.fn_receita_vem_dos_modulos(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_receita_vem_dos_modulos(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_receita_vem_dos_modulos(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_receita_vem_dos_modulos(uuid) TO authenticated, service_role;

-- ============================================================================
-- (1) A sincronia para de sobrescrever a receita digitada.
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
  v_tem_oem boolean;
  v_todos_pagos boolean;
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
    -- O total do parceiro manda no custo; sem ele, multiplica.
    COALESCE(SUM(COALESCE(vlr_custo_total, COALESCE(vlr_custo, 0) * quantidade)), 0),
    COUNT(*),
    COALESCE(bool_or(origem = 'oem'), false),
    COALESCE(bool_and(COALESCE(vlr_mensal, 0) > 0), false)
  INTO v_soma_mensal, v_soma_custo, v_count_ativos, v_tem_oem, v_todos_pagos
  FROM cliente_produto_modulos
  WHERE cliente_produto_id = v_cliente_produto_id
    AND ativo = true;

  -- Sem módulo ativo não há de onde tirar número: preserva o que está gravado.
  IF v_count_ativos = 0 THEN
    UPDATE cliente_produtos SET updated_at = now() WHERE id = v_cliente_produto_id;
    RETURN NULL;
  END IF;

  -- A receita só é dos módulos quando TODOS têm valor. Este IF é a correção:
  -- antes bastava a soma ser diferente de zero, e um único módulo pago
  -- substituía a receita inteira do produto pela dele.
  IF v_todos_pagos AND v_soma_mensal <> 0 THEN
    UPDATE cliente_produtos
       SET vlr_mensal = v_soma_mensal,
           vlr_custo  = v_soma_custo,
           updated_at = now()
     WHERE id = v_cliente_produto_id;
    RETURN NULL;
  END IF;

  -- Receita é a digitada no produto. O custo, quando vem do parceiro, continua
  -- seguindo os módulos: quem dá unidade grátis é o OEM, e é ele quem sabe.
  IF v_tem_oem THEN
    UPDATE cliente_produtos
       SET vlr_custo  = v_soma_custo,
           updated_at = now()
     WHERE id = v_cliente_produto_id;
  ELSE
    UPDATE cliente_produtos SET updated_at = now() WHERE id = v_cliente_produto_id;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.fn_sync_produto_valores() OWNER TO postgres;

COMMENT ON FUNCTION public.fn_sync_produto_valores() IS
  'Sincroniza vlr_mensal/vlr_custo de cliente_produtos a partir dos modulos ativos. A RECEITA so vira a soma dos modulos quando TODOS os ativos tem valor; com qualquer um zerado (o caso do OEM), a receita digitada no produto e preservada e a venda nova entra por movimento de MRR. O CUSTO usa vlr_custo_total quando o parceiro manda um e segue os modulos sempre que houver modulo do OEM. Skip via doctorsaas.skip_valor_sync=true.';

-- ============================================================================
-- (2) Cancelar módulo gera o downsell.
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

  -- Medido ANTES da baixa: é o estado em que a decisão foi tomada. Depois de
  -- inativar a linha, o conjunto de módulos ativos já é outro.
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
           cancelado_em           = (v_data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
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
           cancelado_em           = (v_data::timestamp AT TIME ZONE 'America/Sao_Paulo'),
           cancelado_por          = coalesce(auth.uid(), v_row.cancelado_por),
           updated_at             = now()
     WHERE id = p_id;

    v_res := jsonb_build_object('cancelado', true, 'parcial', true,
                                'quantidade', v_cancel, 'restante', v_atual - v_cancel,
                                'data', v_data);
  END IF;

  -- ---- o movimento de MRR -------------------------------------------------
  -- Só quando a receita NÃO vem dos módulos. Vindo, o gatilho de sincronia já
  -- baixou o valor do produto e o movimento descontaria a mesma saída de novo.
  v_mensal := coalesce(v_row.vlr_mensal, 0) * v_cancel;

  IF NOT v_dos_mod AND v_mensal > 0 AND v_cliente IS NOT NULL THEN
    -- Custo proporcional ao que saiu. Com o total do parceiro, a parte que sai
    -- é a fração da quantidade — o unitário do OEM não vale como divisor
    -- quando ele dá unidade grátis.
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
