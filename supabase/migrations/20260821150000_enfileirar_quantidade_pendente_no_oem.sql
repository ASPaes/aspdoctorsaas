-- ============================================================================
-- ANTES DE TUDO: conserto de um erro que ja esta em producao.
--
-- fn_oem_enfileirar ordena por oem_integration.created_at. A coluna nao existe
-- -- o nome ali e criado_em. Efeito: o cancelamento de modulo pela fila FALHA
-- com "column created_at does not exist". Passou despercebido porque o corpo de
-- uma funcao plpgsql so resolve nomes na EXECUCAO, e nenhum cancelamento
-- aconteceu desde que a funcao subiu.
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

  -- coalesce POR FORA da expressão inteira: com os dois lados NULL, NOT NULL é
  -- NULL, o IF não dispara e o portão liberaria para quem não tem perfil.
  IF NOT coalesce(
    (v_mod.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false),
    false
  ) THEN
    RAISE EXCEPTION 'Sem permissão para sincronizar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cp FROM public.cliente_produtos WHERE id = v_mod.cliente_produto_id;

  -- Módulo digitado à mão não tem licença no parceiro; quem chamou trata o NULL.
  IF v_mod.origem <> 'oem' OR v_cp.oem_codigo_filial IS NULL OR v_mod.oem_modulo_codigo IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario, payload, usuario_id
  )
  SELECT
    v_mod.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = v_mod.tenant_id AND ativo = true ORDER BY criado_em LIMIT 1),
    v_cp.id, v_mod.id,
    p_acao, v_cp.oem_codigo_grupo, v_cp.oem_codigo_filial, v_mod.oem_modulo_codigo,
    -- No cancelamento, o que vai ao parceiro é QUANTO SOBRA na licença.
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
-- Enfileira, para o parceiro julgar, a quantidade que foi decidida na ficha e
-- o OEM ainda não conhece.
--
-- Contexto: somar quantidade em "Adicionar Módulo" grava direto na ficha e não
-- avisa ninguém — o envio ao OEM (o "C") ainda não existe. Quem soma hoje fica
-- com a ficha em 3 e a licença em 2, sem nada indicando isso.
--
-- `quantidade_manual` é exatamente a marca de "este número foi decidido aqui":
-- é ela que impede a próxima carga do espelho de devolver o número antigo. Se
-- ela existe e é diferente do que o espelho trouxe, o parceiro não sabe.
--
-- Só enfileira o que ainda não tem linha viva na fila, para rodar duas vezes
-- não mandar a mesma alteração duas vezes ao parceiro.
-- ============================================================================
DO $envio$
DECLARE
  v_n int;
BEGIN
  WITH espelho AS (
    -- O que o OEM diz que a licença tem hoje, por filial e código de módulo.
    SELECT DISTINCT ON (ef.tenant_id, ef.filial_codigo, x.codigo)
           ef.tenant_id, ef.filial_codigo, x.codigo,
           greatest(coalesce(x.quantidade, 1), 1) AS quantidade
      FROM public.oem_espelho_filial ef
           CROSS JOIN LATERAL jsonb_to_recordset(ef.modulos)
             AS x(codigo int, ativo boolean, quantidade numeric)
     WHERE jsonb_typeof(ef.modulos) = 'array'
       AND coalesce(x.ativo, true) = true
       AND x.codigo IS NOT NULL
     ORDER BY ef.tenant_id, ef.filial_codigo, x.codigo, ef.atualizado_em DESC
  ),
  pendente AS (
    SELECT c.id AS modulo_linha_id, c.tenant_id, cp.id AS cliente_produto_id,
           cp.oem_codigo_grupo, cp.oem_codigo_filial, c.oem_modulo_codigo,
           c.quantidade_manual AS quantidade_nova, c.vlr_custo,
           e.quantidade AS quantidade_no_oem
      FROM public.cliente_produto_modulos c
      JOIN public.cliente_produtos cp ON cp.id = c.cliente_produto_id
      JOIN espelho e
        ON e.tenant_id = cp.tenant_id
       AND e.filial_codigo = cp.oem_codigo_filial
       AND e.codigo = c.oem_modulo_codigo
     WHERE c.ativo = true
       AND c.origem = 'oem'
       AND c.quantidade_manual IS NOT NULL
       AND c.quantidade_manual <> e.quantidade
       AND NOT EXISTS (
         SELECT 1 FROM public.oem_sync_fila f
          WHERE f.modulo_linha_id = c.id
            AND f.status IN ('pendente','processando','erro')
       )
  )
  INSERT INTO public.oem_sync_fila (
    tenant_id, conta_integration_id, cliente_produto_id, modulo_linha_id,
    acao, empresa_codigo, filial_codigo, oem_modulo_codigo,
    quantidade, valor_unitario
  )
  SELECT
    p.tenant_id,
    (SELECT id FROM public.oem_integration
      WHERE tenant_id = p.tenant_id AND ativo = true ORDER BY criado_em LIMIT 1),
    p.cliente_produto_id, p.modulo_linha_id,
    'quantidade', p.oem_codigo_grupo, p.oem_codigo_filial, p.oem_modulo_codigo,
    p.quantidade_nova, p.vlr_custo
  FROM pendente p;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'enfileiradas % alteracao(oes) de quantidade para o OEM julgar', v_n;
END
$envio$;
