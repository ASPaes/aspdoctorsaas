-- ============================================================================
-- OEM: o pedido passa a sair pela conta CERTA, não pela primeira do tenant.
--
-- POR QUE (27/08/2026)
--
-- `fn_oem_enfileirar` e `fn_oem_enfileirar_novo` gravavam a conta assim:
--
--   (SELECT id FROM public.oem_integration
--     WHERE tenant_id = … AND ativo = true ORDER BY criado_em LIMIT 1)
--
-- A unidade do cliente e a filial da licença não entravam nessa conta. Com UMA
-- conta conectada isso sempre acertou, porque só havia uma resposta possível.
-- Na segunda conta (Digi Up), todo pedido continuaria carimbado com a conta
-- mais antiga (Digi Office) e o processador o enviaria com a CHAVE DELA. O
-- parceiro ou recusa a filial, ou — pior — aceita numa empresa que não é aquela.
--
-- Não é bug de tela: é escrita na licença do cliente com a credencial errada.
--
-- COMO SE RESOLVE A CONTA, EM ORDEM
--
--   1. ONDE A LICENÇA ESTÁ. `oem_espelho_filial` guarda cada filial com a conta
--      que a trouxe. É a resposta literal para "qual chave alcança esta
--      licença", e é a única que continua certa quando o cadastro do cliente
--      está na unidade errada.
--   2. PELA UNIDADE DO CLIENTE, quando a filial ainda não está no espelho
--      (licença nova, primeiro espelho não rodou): `unidades_base_ids` da conta
--      contra `clientes.unidade_base_id`.
--   3. NADA. Aí levanta exceção, em vez de escolher uma conta qualquer. O
--      clique falha na cara de quem clicou, com o motivo — que é infinitamente
--      melhor do que o pedido sair calado pela empresa errada.
--
-- AMBIGUIDADE TAMBÉM É ERRO. Se a mesma filial aparecer no espelho de duas
-- contas, a unidade do cliente desempata; se nem isso resolver, levanta. Chutar
-- aqui é o mesmo defeito de origem, com outra roupa.
--
-- O QUE ISSO MUDA HOJE: nada. Medido antes de escrever: 1 conta ativa, 869
-- produtos com licença, e todos resolvem para ela pelo passo 1. Os 3 clientes
-- que estão na unidade Digi Up com a licença no espelho da Digi Office
-- continuam saindo pela Digi Office, que é onde a licença de fato está — o
-- cadastro deles é outro assunto, e a aba Divergências é o lugar dele.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------- o resolvedor
CREATE OR REPLACE FUNCTION public.fn_oem_conta_da_licenca(
  p_tenant_id     uuid,
  p_filial_codigo text,
  p_empresa_codigo text,
  p_cliente_id    uuid
) RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unidade  bigint;
  v_contas   uuid[];
  v_id       uuid;
BEGIN
  SELECT c.unidade_base_id INTO v_unidade
    FROM public.clientes c WHERE c.id = p_cliente_id;

  -- 1. onde a licença está, segundo o espelho
  SELECT array_agg(DISTINCT e.conta_integration_id)
    INTO v_contas
    FROM public.oem_espelho_filial e
    JOIN public.oem_integration i ON i.id = e.conta_integration_id AND i.ativo = true
   WHERE e.tenant_id = p_tenant_id
     AND e.filial_codigo = p_filial_codigo
     AND (p_empresa_codigo IS NULL OR e.empresa_codigo = p_empresa_codigo);

  IF coalesce(array_length(v_contas, 1), 0) = 1 THEN
    RETURN v_contas[1];
  END IF;

  -- Mesma filial no espelho de duas contas: quem desempata é a unidade do
  -- cliente. Sem desempate, ninguém escolhe por chute.
  IF coalesce(array_length(v_contas, 1), 0) > 1 THEN
    SELECT i.id INTO v_id
      FROM public.oem_integration i
     WHERE i.id = ANY(v_contas)
       AND v_unidade IS NOT NULL
       AND i.unidades_base_ids @> ARRAY[v_unidade]
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    RAISE EXCEPTION
      'A filial % do OEM aparece em mais de uma conta e o cliente não diz qual é a dele.',
      p_filial_codigo USING ERRCODE = '22023';
  END IF;

  -- 2. licença ainda não espelhada: vale a unidade do cliente
  IF v_unidade IS NOT NULL THEN
    SELECT i.id INTO v_id
      FROM public.oem_integration i
     WHERE i.tenant_id = p_tenant_id
       AND i.ativo = true
       AND i.unidades_base_ids @> ARRAY[v_unidade]
     ORDER BY i.criado_em
     LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  RETURN NULL;
END;
$$;

ALTER FUNCTION public.fn_oem_conta_da_licenca(uuid, text, text, uuid) OWNER TO postgres;
-- Só quem já roda como definer (as duas de enfileiramento) e o service_role
-- precisam dela. `authenticated` fica de fora explicitamente: REVOKE FROM
-- PUBLIC sozinho não tira o EXECUTE que o default privilege já deu.
REVOKE ALL ON FUNCTION public.fn_oem_conta_da_licenca(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_conta_da_licenca(uuid, text, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_conta_da_licenca(uuid, text, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_conta_da_licenca(uuid, text, text, uuid) TO service_role;

-- ------------------------------------------- enfileirar alteração de um módulo
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao            text,
  p_quantidade      numeric DEFAULT NULL,
  p_payload         jsonb   DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mod    public.cliente_produto_modulos;
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_conta  uuid;
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

  -- A conta sai da licença, não da idade do cadastro. Sem conta, o pedido não
  -- entra na fila: enfileirar sem saber por qual empresa enviar é o defeito.
  v_conta := public.fn_oem_conta_da_licenca(
    v_mod.tenant_id, v_cp.oem_codigo_filial, v_cp.oem_codigo_grupo, v_cp.cliente_id);
  IF v_conta IS NULL THEN
    RAISE EXCEPTION
      'Não dá para saber por qual conta do OEM enviar: a filial % não está em nenhum espelho e a unidade do cliente não tem chave conectada.',
      v_cp.oem_codigo_filial USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id
  )
  SELECT
    v_mod.tenant_id,
    v_conta,
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

ALTER FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) TO authenticated, service_role;

-- --------------------------------------------- enfileirar módulo novo (ativar)
CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar_novo(
  p_cliente_produto_id uuid,
  p_modulo_id          uuid,
  p_quantidade         numeric,
  p_payload            jsonb DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp     public.cliente_produtos;
  v_codigo integer;
  v_conta  uuid;
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

  v_conta := public.fn_oem_conta_da_licenca(
    v_cp.tenant_id, v_cp.oem_codigo_filial, v_cp.oem_codigo_grupo, v_cp.cliente_id);
  IF v_conta IS NULL THEN
    RAISE EXCEPTION
      'Não dá para saber por qual conta do OEM enviar: a filial % não está em nenhum espelho e a unidade do cliente não tem chave conectada.',
      v_cp.oem_codigo_filial USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_catalogo_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id
  ) VALUES (
    v_cp.tenant_id,
    v_conta,
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

ALTER FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) TO authenticated, service_role;

COMMIT;

-- ---------------------------------------------------------------------------
-- CONFERÊNCIA (só leitura) — toda licença de hoje tem que resolver para uma
-- conta, e nenhuma pode resolver para NULL:
--
--   SELECT coalesce(public.fn_oem_conta_da_licenca(
--            cp.tenant_id, cp.oem_codigo_filial, cp.oem_codigo_grupo, cp.cliente_id
--          )::text, 'SEM CONTA') AS conta,
--          count(*)
--     FROM public.cliente_produtos cp
--    WHERE cp.oem_codigo_filial IS NOT NULL
--    GROUP BY 1 ORDER BY 2 DESC;
-- ---------------------------------------------------------------------------
