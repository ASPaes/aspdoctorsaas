-- OEM — módulo em produto com licença SEMPRE passa pela fila.
--
-- Antes, as duas funções de enfileiramento devolviam NULL em três situações, e
-- o frontend lia esse NULL como "cliente sem OEM, grava só na ficha" — com o
-- mesmo toast de sucesso. Duas dessas situações são erro, não caminho feliz:
--
--   1. produto do cliente COM licença, mas o módulo do catálogo sem
--      `produto_modulos.oem_modulo_codigo`;
--   2. módulo da ficha com `origem <> 'oem'` (digitado à mão) dentro de um
--      produto que TEM licença — o pedido de quantidade nunca chegava ao
--      parceiro.
--
-- Em ambos o módulo entrava só na ficha, calado, e as duas bases divergiam sem
-- ninguém saber. Agora só sobra UM motivo para não enfileirar: o produto do
-- cliente não ter licença no parceiro (`oem_codigo_filial IS NULL`) — aí não há
-- o que enviar e o frontend grava na ficha como sempre fez.
--
-- Faltando o código do módulo, a linha entra na fila assim mesmo: o processador
-- a reivindica, vê que não dá para chamar o parceiro e a deixa `invalido` com o
-- motivo escrito. Fica PARADA e visível — que é o pedido: nada de módulo que
-- some sem rastro.

-- ---------------------------------------------------------------- ativar novo
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar_novo(
  p_cliente_produto_id uuid,
  p_modulo_id uuid,
  p_quantidade numeric,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  -- Único motivo legítimo de não enfileirar: não existe licença no parceiro.
  -- Quem chamou trata o NULL gravando direto na ficha, como sempre fez.
  IF v_cp.oem_codigo_filial IS NULL THEN
    RETURN NULL;
  END IF;

  -- Uma ação viva por módulo. Sem isto, clicar duas vezes manda duas alterações
  -- ao parceiro e a segunda desfaz ou duplica a primeira. `invalido` fica de
  -- fora de propósito: aquela linha está morta, e depois de corrigir o cadastro
  -- a pessoa precisa poder pedir de novo.
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
$$;

-- ------------------------------------------------ quantidade / cancelamento
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao text,
  p_quantidade numeric DEFAULT NULL,
  p_payload jsonb DEFAULT NULL
) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_mod    public.cliente_produto_modulos;
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_id     uuid;
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

  -- Único motivo legítimo de não enfileirar: não existe licença no parceiro.
  --
  -- `origem` saiu daqui de propósito. Módulo digitado à mão dentro de um produto
  -- COM licença é justamente o caso em que a ficha e o parceiro divergem — e era
  -- o único que nunca chegava lá.
  IF v_cp.oem_codigo_filial IS NULL THEN
    RETURN NULL;
  END IF;

  -- O código do parceiro na linha da ficha só é preenchido pelo espelho; o
  -- módulo criado à mão tem o código no catálogo. Faltando os dois, a linha
  -- ainda entra: o processador a deixa `invalido` com o motivo, à vista.
  v_codigo := coalesce(
    v_mod.oem_modulo_codigo,
    (SELECT pm.oem_modulo_codigo FROM public.produto_modulos pm WHERE pm.id = v_mod.modulo_id)
  );

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
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
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
$$;

-- ------------------------------------------------------ pendências na ficha
-- `invalido` é o estado de quem PRECISA de gente: o pedido não foi ao parceiro e
-- não vai sozinho. Ficar de fora desta lista era o mesmo silêncio de antes — o
-- selo sumia da ficha do cliente e só sobrava a aba Fila, que ninguém abre.
CREATE OR REPLACE FUNCTION public.fn_oem_pendencias_do_cliente(p_cliente_id uuid)
RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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
       AND f.status IN ('pendente','processando','erro','invalido')
  ), '[]'::jsonb);
END;
$$;

-- CREATE OR REPLACE preserva os privilégios, mas declarar deixa o arquivo
-- autossuficiente se alguém precisar recriar do zero.
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_oem_pendencias_do_cliente(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_pendencias_do_cliente(uuid) TO authenticated, service_role;
