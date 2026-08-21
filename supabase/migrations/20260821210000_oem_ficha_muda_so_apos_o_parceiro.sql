-- ============================================================================
-- A ficha só muda depois que o parceiro aceita.
--
-- Hoje o cancelamento já é assim, mas adicionar e somar quantidade não: eles
-- gravam na ficha na hora e o OEM nem fica sabendo. Se um dia o parceiro
-- recusasse, a ficha diria 3 e a licença 2, sem nada indicando isso.
--
-- Passa a valer a mesma regra dos dois lados: a ação nasce na fila, o
-- processador manda ao parceiro, e SÓ com o "ok" dele a ficha muda. Enquanto
-- isso, a linha aparece na tela como "aguardando confirmação do parceiro" — sem
-- esse aviso a pessoa acha que falhou e tenta de novo.
--
-- Consequência importante: o MOVIMENTO DE MRR também passa a nascer aqui. Não
-- faz sentido registrar uma venda que o parceiro recusou.
-- ============================================================================

-- O módulo do catálogo, para quando ainda não existe linha na ficha (é o caso
-- de "ativar": a linha só será criada depois do aceite).
ALTER TABLE public.oem_sync_fila
  ADD COLUMN IF NOT EXISTS modulo_catalogo_id uuid REFERENCES public.produto_modulos(id);

COMMENT ON COLUMN public.oem_sync_fila.modulo_catalogo_id IS
  'Módulo do catálogo. Usado quando a ficha ainda não tem a linha — em "ativar" ela nasce só depois do aceite do parceiro.';

-- ============================================================================
-- Enfileirar um módulo que o cliente AINDA NÃO TEM.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar_novo(
  p_cliente_produto_id uuid,
  p_modulo_id          uuid,
  p_quantidade         numeric,
  p_payload            jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_id     uuid;
BEGIN
  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = p_cliente_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do cliente não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_cp.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT oem_modulo_codigo INTO v_codigo
    FROM public.produto_modulos WHERE id = p_modulo_id;

  -- Sem licença ou sem código no parceiro não há o que enviar: quem chamou
  -- trata o NULL gravando direto na ficha, como sempre fez.
  IF v_cp.oem_codigo_filial IS NULL OR v_codigo IS NULL THEN
    RETURN NULL;
  END IF;

  -- Uma ação viva por módulo. Sem isto, clicar duas vezes manda duas alterações
  -- ao parceiro e a segunda desfaz ou duplica a primeira.
  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.cliente_produto_id = p_cliente_produto_id
       AND coalesce(f.modulo_catalogo_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_modulo_id
       AND f.status IN ('pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo aguardando o parceiro.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id
  ) VALUES (
    v_cp.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = v_cp.tenant_id AND ativo = true ORDER BY criado_em LIMIT 1),
    v_cp.id, p_modulo_id,
    'ativar', v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
    greatest(coalesce(p_quantidade, 1), 1),
    nullif(p_payload->>'vlr_custo', '')::numeric,
    p_payload,
    auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) TO authenticated, service_role;

-- ============================================================================
-- A mesma trava para o módulo que já está na ficha.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao            text,
  p_quantidade      numeric DEFAULT NULL,
  p_payload         jsonb   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_mod public.cliente_produto_modulos;
  v_cp  public.cliente_produtos;
  v_id  uuid;
BEGIN
  IF p_acao NOT IN ('ativar','quantidade','cancelar') THEN
    RAISE EXCEPTION 'Ação inválida: %', p_acao USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_mod FROM public.cliente_produto_modulos WHERE id = p_modulo_linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(
    (v_mod.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_mod.cliente_produto_id;

  IF v_mod.origem <> 'oem' OR v_cp.oem_codigo_filial IS NULL OR v_mod.oem_modulo_codigo IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.modulo_linha_id = v_mod.id
       AND f.status IN ('pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo aguardando o parceiro.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id
  )
  SELECT
    v_mod.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = v_mod.tenant_id AND ativo = true ORDER BY criado_em LIMIT 1),
    v_cp.id, v_mod.id, v_mod.modulo_id,
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_mod.oem_modulo_codigo,
    -- No cancelamento o que vai ao parceiro é QUANTO SOBRA na licença; nas
    -- outras ações, a quantidade que a licença deve passar a ter.
    CASE WHEN p_acao = 'cancelar'
         THEN greatest(coalesce(v_mod.quantidade, 1)
                       - least(greatest(coalesce(p_quantidade, coalesce(v_mod.quantidade, 1)), 1),
                               greatest(coalesce(v_mod.quantidade, 1), 1)), 0)
         ELSE coalesce(p_quantidade, v_mod.quantidade, 1) END,
    v_mod.vlr_custo,
    p_payload,
    auth.uid()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

ALTER FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) TO authenticated, service_role;

-- ============================================================================
-- O aceite do parceiro vira verdade AQUI, e em nenhum outro lugar.
--   cancelar   -> baixa na ficha (já existia)
--   quantidade -> a quantidade sobe, e o upsell da diferença nasce
--   ativar     -> a linha da ficha é criada, e o upsell nasce
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

  -- Medido ANTES de mexer: é o estado em que a decisão foi tomada.
  v_dos_mod := public.fn_receita_vem_dos_modulos(v_l.cliente_produto_id);
  v_mensal  := coalesce(nullif(v_l.payload->>'vlr_mensal', '')::numeric, 0);

  -- ------------------------------------------------------------- cancelar
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
      nullif(v_l.payload->>'data', '')::date
    );
    RETURN jsonb_build_object('aplicado', true, 'ficha', v_res);
  END IF;

  -- ----------------------------------------------------------- quantidade
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

  -- --------------------------------------------------------------- ativar
  ELSIF v_l.acao = 'ativar' THEN
    IF v_l.modulo_catalogo_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo do catálogo');
    END IF;
    -- Já criada numa passada anterior: repetir duplicaria a linha.
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

  -- ------------------------------------------------------------ o upsell
  -- Só quando a receita NÃO vem dos módulos: vindo, o gatilho de sincronia já
  -- reescreveu o valor do produto e o movimento contaria a mesma venda de novo.
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

-- ============================================================================
-- O que a ficha do cliente precisa saber para mostrar "aguardando o parceiro".
-- Uma chamada por cliente, em vez de a tela vasculhar a fila inteira.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_pendencias_do_cliente(p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.clientes WHERE id = p_cliente_id;
  IF NOT coalesce(
       v_tenant = public.current_tenant_id() OR coalesce(public.is_super_admin(), false),
       false) THEN
    RAISE EXCEPTION 'Sem permissão.' USING ERRCODE = '42501';
  END IF;

  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
             'fila_id',            f.id,
             'cliente_produto_id', f.cliente_produto_id,
             'modulo_linha_id',    f.modulo_linha_id,
             'modulo_catalogo_id', f.modulo_catalogo_id,
             'modulo',             pm.nome,
             'acao',               f.acao,
             'quantidade',         f.quantidade,
             'status',             f.status,
             'ultimo_erro',        f.ultimo_erro,
             'enfileirado_em',     f.enfileirado_em))
      FROM public.oem_sync_fila f
      JOIN public.cliente_produtos cp ON cp.id = f.cliente_produto_id
      LEFT JOIN public.produto_modulos pm ON pm.id = f.modulo_catalogo_id
     WHERE cp.cliente_id = p_cliente_id
       AND f.status IN ('pendente','processando','erro')
  ), '[]'::jsonb);
END;
$$;

ALTER FUNCTION public.fn_oem_pendencias_do_cliente(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_pendencias_do_cliente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_pendencias_do_cliente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_pendencias_do_cliente(uuid) TO authenticated, service_role;
