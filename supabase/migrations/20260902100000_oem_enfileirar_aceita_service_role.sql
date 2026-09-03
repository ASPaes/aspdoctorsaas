-- ============================================================================
-- As duas portas da fila do OEM passam a aceitar o servidor.
--
-- Motivo: a integração da calculadora (`fn_intake_proposta`) roda como
-- `service_role`. Nessa role `current_tenant_id()` e `is_admin_or_head()` são
-- NULL/false, o portão nega, e por isso o intake nunca chamou estas funções —
-- ele escrevia direto em `cliente_produto_modulos` e o módulo jamais chegava
-- ao parceiro. Medido em 31/08/2026: o Estoque da SORVETE REAL 2 (filial 23272)
-- entrou na ficha com ZERO linhas na `oem_sync_fila`.
--
-- Isto não concede privilégio novo: `service_role` tem `rolbypassrls` e já
-- podia escrever na `oem_sync_fila` direto. O portão fechado só tornava a
-- função canônica inutilizável, empurrando para escrita manual — que é
-- exatamente o defeito que a fila existe para impedir.
--
-- O padrão é o mesmo já aplicado em `create_cliente_produto_with_contract`
-- (30/08/2026): `current_setting('role')` sobrevive ao SECURITY DEFINER, e a
-- comparação `IS DISTINCT FROM` nunca devolve NULL.
--
-- ⚠️ O `coalesce` continua POR FORA da expressão inteira do portão de gente.
-- Com os dois lados NULL, `NOT (NULL)` é NULL, o IF não dispara e o portão
-- liberaria justamente para quem não tem perfil. Ver a migration
-- 20260821020000_oem_fila_de_sincronizacao.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar(
  p_modulo_linha_id uuid,
  p_acao text,
  p_quantidade numeric DEFAULT NULL::numeric,
  p_payload jsonb DEFAULT NULL::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- O servidor entra por fora do portão de gente: quem chama é a integração,
  -- que não tem perfil nem tenant. Quem valida o tenant nesse caminho é a
  -- própria `fn_intake_proposta`, que só age no cliente que ela resolveu.
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT coalesce(
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

  -- Uma ação viva por módulo. 'aguardando_aprovacao' entra na lista: sem ele,
  -- pedir duas vezes encheria a fila de aprovação com o mesmo módulo e o admin
  -- teria que adivinhar qual dos dois vale.
  -- 'recusado' fica de fora de propósito, como 'invalido': depois de corrigir o
  -- que o admin apontou, a pessoa PRECISA poder pedir de novo.
  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.modulo_linha_id = v_mod.id
       AND f.status IN ('aguardando_aprovacao','pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo em andamento.' USING ERRCODE = '23505';
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
    quantidade, valor_unitario, payload, usuario_id, status
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
    -- auth.uid() basta aqui (só gente logada chama), mas fn_acting_user cobre
    -- também a chamada por service_role, onde auth.uid() é NULL e a autoria
    -- nasceria órfã sem erro nenhum.
    public.fn_acting_user(),
    'aguardando_aprovacao'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar(uuid, text, numeric, jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.fn_oem_enfileirar_novo(
  p_cliente_produto_id uuid,
  p_modulo_id uuid,
  p_quantidade numeric,
  p_payload jsonb DEFAULT NULL::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND NOT coalesce(
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

  IF EXISTS (
    SELECT 1 FROM public.oem_sync_fila f
     WHERE f.cliente_produto_id = p_cliente_produto_id
       AND coalesce(f.modulo_catalogo_id, '00000000-0000-0000-0000-000000000000'::uuid) = p_modulo_id
       AND f.status IN ('aguardando_aprovacao','pendente','processando','erro')
  ) THEN
    RAISE EXCEPTION 'Já existe um pedido deste módulo em andamento.' USING ERRCODE = '23505';
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
    quantidade, valor_unitario, payload, usuario_id, status
  ) VALUES (
    v_cp.tenant_id,
    v_conta,
    v_cp.id, p_modulo_id,
    'ativar', v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_codigo,
    greatest(coalesce(p_quantidade, 1), 1),
    nullif(p_payload->>'vlr_custo', '')::numeric,
    p_payload,
    public.fn_acting_user(),
    'aguardando_aprovacao'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

ALTER FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_enfileirar_novo(uuid, uuid, numeric, jsonb) TO authenticated, service_role;
