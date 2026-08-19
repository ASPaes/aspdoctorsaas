-- ============================================================================
-- OEM › Módulos: um produto do catálogo do parceiro pode virar VÁRIOS produtos
-- do DoctorSaaS.
--
-- O desenho anterior travava em um só (UNIQUE por conta+produto_codigo). Na
-- operação real a mesma licença do OEM é vendida aqui em mais de uma linha de
-- produto — "PDV Legal - Servidor" e "PDV Legal - Terminal" saem do mesmo
-- GESTAO LEGAL —, e todas precisam da mesma lista de módulos.
--
-- O que NÃO cai: a UNIQUE por conta+produto_id. Um produto do DoctorSaaS
-- continua podendo pertencer a um único produto do OEM — se pertencesse a dois,
-- cada upgrade sobrescreveria os módulos do outro e o último a rodar venceria.
-- ============================================================================

ALTER TABLE public.oem_produto_vinculo
  DROP CONSTRAINT IF EXISTS oem_produto_vinculo_uniq_oem;

-- A coluna da grade agora é lida em lista: sem índice, achar os produtos de um
-- produto_codigo vira varredura toda vez que a aba Módulos abre.
CREATE INDEX IF NOT EXISTS idx_oem_produto_vinculo_codigo
  ON public.oem_produto_vinculo (conta_integration_id, produto_codigo);

-- A assinatura muda de bigint para bigint[]. Dropar é obrigatório: deixar as
-- duas conviverem cria sobrecarga ambígua, e o PostgREST escolheria a que
-- casasse com o corpo do request — o que na prática é sorteio.
DROP FUNCTION IF EXISTS public.fn_oem_vincular_produto(uuid, text, bigint, boolean, boolean);

CREATE OR REPLACE FUNCTION public.fn_oem_vincular_produto(
  p_conta_integration_id uuid,
  p_produto_codigo       text,
  p_produto_ids          bigint[],
  p_upgrade              boolean DEFAULT false,
  p_somente_com_valor    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_tenant         uuid;
  v_produto_tenant uuid;
  v_nome_oem       text;
  v_pid            bigint;
  v_total_oem      int := 0;
  v_criados        int := 0;
  v_atualizados    int := 0;
  v_apagados       int := 0;
  v_inativados     int := 0;
  v_p_criados      int := 0;
  v_p_atualizados  int := 0;
  v_p_apagados     int := 0;
  v_p_inativados   int := 0;
  v_desvinculados  int := 0;
  v_por_produto    jsonb := '[]'::jsonb;
  v_resumo         jsonb;
BEGIN
  -- coalesce porque helper de permissão que devolve NULL faz o IF NOT (...)
  -- nunca disparar: o portão passaria a liberar em vez de barrar.
  IF NOT coalesce(public.is_admin_or_head(), false) THEN
    RAISE EXCEPTION 'Sem permissão para vincular produtos do OEM.' USING ERRCODE = '42501';
  END IF;

  IF p_produto_ids IS NULL OR array_length(p_produto_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Escolha pelo menos um produto do DoctorSaaS.' USING ERRCODE = '22023';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.oem_integration WHERE id = p_conta_integration_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Conta OEM não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(public.is_super_admin(), false)
     AND v_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'Esta conta OEM é de outro tenant.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.oem_espelho_modulo_preco
     WHERE conta_integration_id = p_conta_integration_id
       AND produto_codigo = p_produto_codigo
  ) THEN
    RAISE EXCEPTION 'O produto % não está na grade de preços desta conta. Atualize o espelho.', p_produto_codigo
      USING ERRCODE = 'P0002';
  END IF;

  -- Valida a lista INTEIRA antes de escrever qualquer coisa. Meia lista
  -- gravada é pior que nada: ninguém sabe onde a importação parou.
  FOREACH v_pid IN ARRAY p_produto_ids LOOP
    SELECT tenant_id INTO v_produto_tenant FROM public.produtos WHERE id = v_pid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto do DoctorSaaS % não encontrado.', v_pid USING ERRCODE = 'P0002';
    END IF;
    IF v_produto_tenant IS NOT NULL AND v_produto_tenant IS DISTINCT FROM v_tenant THEN
      RAISE EXCEPTION 'O produto % é de outro tenant.', v_pid USING ERRCODE = '42501';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.oem_produto_vinculo
       WHERE conta_integration_id = p_conta_integration_id
         AND produto_id = v_pid
         AND produto_codigo <> p_produto_codigo
    ) THEN
      RAISE EXCEPTION 'O produto "%" já está vinculado a outro produto do OEM nesta conta.',
        (SELECT nome FROM public.produtos WHERE id = v_pid) USING ERRCODE = '23505';
    END IF;
  END LOOP;

  SELECT produto_nome INTO v_nome_oem
    FROM public.oem_espelho_modulo_preco
   WHERE conta_integration_id = p_conta_integration_id
     AND produto_codigo = p_produto_codigo
   LIMIT 1;

  -- A lista recebida É o vínculo: produto que saiu dela deixa de estar
  -- vinculado. Desvincular não mexe em módulo nenhum — só desfaz o de-para.
  DELETE FROM public.oem_produto_vinculo
   WHERE conta_integration_id = p_conta_integration_id
     AND produto_codigo = p_produto_codigo
     AND NOT (produto_id = ANY (p_produto_ids));
  GET DIAGNOSTICS v_desvinculados = ROW_COUNT;

  INSERT INTO public.oem_produto_vinculo
    (tenant_id, conta_integration_id, produto_codigo, produto_nome, produto_id, criado_por)
  SELECT v_tenant, p_conta_integration_id, p_produto_codigo,
         coalesce(v_nome_oem, p_produto_codigo), pid, auth.uid()
    FROM unnest(p_produto_ids) AS pid
  ON CONFLICT (conta_integration_id, produto_id) DO UPDATE
    SET produto_codigo = EXCLUDED.produto_codigo,
        produto_nome   = EXCLUDED.produto_nome,
        atualizado_em  = now();

  IF NOT p_upgrade THEN
    RETURN jsonb_build_object(
      'upgrade', false, 'vinculado', true,
      'produtos', array_length(p_produto_ids, 1),
      'desvinculados', v_desvinculados
    );
  END IF;

  -- A lista do OEM é a mesma para todos os produtos da chamada: monta uma vez.
  -- Deduplicada por nome normalizado — dois módulos do catálogo com o mesmo
  -- nome viram um só aqui, senão o segundo entraria como duplicata invisível.
  DROP TABLE IF EXISTS _oem_mods;
  CREATE TEMP TABLE _oem_mods ON COMMIT DROP AS
    SELECT DISTINCT ON (public.fn_norm_nome_modulo(p.modulo_nome))
           public.fn_norm_nome_modulo(p.modulo_nome) AS chave,
           btrim(p.modulo_nome)                      AS nome,
           p.modulo_codigo                           AS modulo_codigo,
           coalesce(p.valor_unitario, 0)             AS valor
      FROM public.oem_espelho_modulo_preco p
     WHERE p.conta_integration_id = p_conta_integration_id
       AND p.produto_codigo = p_produto_codigo
       AND (NOT p_somente_com_valor OR coalesce(p.valor_unitario, 0) > 0)
     ORDER BY public.fn_norm_nome_modulo(p.modulo_nome), p.modulo_codigo;

  SELECT count(*) INTO v_total_oem FROM _oem_mods;

  FOREACH v_pid IN ARRAY p_produto_ids LOOP
    -- 1) Reaproveita o que já existe com o mesmo nome. Só o custo é atualizado:
    --    margem e preço de venda são decisão comercial, não vêm do parceiro.
    WITH alvo AS (
      SELECT DISTINCT ON (public.fn_norm_nome_modulo(m.nome))
             m.id, public.fn_norm_nome_modulo(m.nome) AS chave
        FROM public.produto_modulos m
       WHERE m.produto_id = v_pid
       ORDER BY public.fn_norm_nome_modulo(m.nome), m.created_at
    )
    UPDATE public.produto_modulos m
       SET vlr_custo  = o.valor,
           ativo      = true,
           updated_at = now()
      FROM _oem_mods o
      JOIN alvo a ON a.chave = o.chave
     WHERE m.id = a.id;
    GET DIAGNOSTICS v_p_atualizados = ROW_COUNT;

    -- 2) Cria o que o produto ainda não tem.
    INSERT INTO public.produto_modulos
      (tenant_id, produto_id, nome, descricao, ativo, vlr_custo, margem_percentual, vlr_venda)
    SELECT v_tenant, v_pid, o.nome,
           'Importado do OEM · módulo #' || o.modulo_codigo,
           true, o.valor, 0, 0
      FROM _oem_mods o
     WHERE NOT EXISTS (
       SELECT 1 FROM public.produto_modulos m
        WHERE m.produto_id = v_pid
          AND public.fn_norm_nome_modulo(m.nome) = o.chave
     );
    GET DIAGNOSTICS v_p_criados = ROW_COUNT;

    -- 3) Sobra (módulo do produto que o OEM não tem) que NINGUÉM usa: apaga.
    DELETE FROM public.produto_modulos m
     WHERE m.produto_id = v_pid
       AND NOT EXISTS (SELECT 1 FROM _oem_mods o WHERE o.chave = public.fn_norm_nome_modulo(m.nome))
       AND NOT EXISTS (SELECT 1 FROM public.cliente_produto_modulos c WHERE c.modulo_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.contrato_itens ci WHERE ci.modulo_id = m.id)
       AND NOT EXISTS (SELECT 1 FROM public.onboarding_journey_modules j WHERE j.produto_modulo_id = m.id);
    GET DIAGNOSTICS v_p_apagados = ROW_COUNT;

    -- 4) O que sobrou da sobra está em uso por cliente, contrato ou jornada:
    --    apagar quebraria a FK e sumiria com o histórico. Só sai de circulação.
    UPDATE public.produto_modulos m
       SET ativo = false, updated_at = now()
     WHERE m.produto_id = v_pid
       AND m.ativo
       AND NOT EXISTS (SELECT 1 FROM _oem_mods o WHERE o.chave = public.fn_norm_nome_modulo(m.nome));
    GET DIAGNOSTICS v_p_inativados = ROW_COUNT;

    v_criados     := v_criados + v_p_criados;
    v_atualizados := v_atualizados + v_p_atualizados;
    v_apagados    := v_apagados + v_p_apagados;
    v_inativados  := v_inativados + v_p_inativados;

    -- O detalhe por produto existe para o caso em que um deles se comporta
    -- diferente dos outros: com só o total, "22 inativados" não diz em qual.
    v_por_produto := v_por_produto || jsonb_build_object(
      'produto_id',  v_pid,
      'nome',        (SELECT nome FROM public.produtos WHERE id = v_pid),
      'criados',     v_p_criados,
      'atualizados', v_p_atualizados,
      'apagados',    v_p_apagados,
      'inativados',  v_p_inativados
    );

    UPDATE public.oem_produto_vinculo
       SET ultimo_upgrade_em = now(),
           ultimo_upgrade_resumo = jsonb_build_object(
             'total_oem', v_total_oem, 'criados', v_p_criados, 'atualizados', v_p_atualizados,
             'apagados', v_p_apagados, 'inativados', v_p_inativados),
           atualizado_em = now()
     WHERE conta_integration_id = p_conta_integration_id
       AND produto_id = v_pid;
  END LOOP;

  v_resumo := jsonb_build_object(
    'upgrade',       true,
    'vinculado',     true,
    'produtos',      array_length(p_produto_ids, 1),
    'desvinculados', v_desvinculados,
    'total_oem',     v_total_oem,
    'criados',       v_criados,
    'atualizados',   v_atualizados,
    'apagados',      v_apagados,
    'inativados',    v_inativados,
    'por_produto',   v_por_produto
  );

  DROP TABLE IF EXISTS _oem_mods;
  RETURN v_resumo;
END;
$fn$;

ALTER FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint[], boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint[], boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint[], boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint[], boolean, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint[], boolean, boolean) IS
  'Vincula um produto do catálogo do OEM a UM OU MAIS produtos do DoctorSaaS (a lista recebida é o vínculo: quem saiu dela é desvinculado). Com p_upgrade, sincroniza produto_modulos de cada um com a coluna do OEM: casa por nome (atualiza vlr_custo), cria o que falta, apaga a sobra sem uso e inativa a sobra em uso.';
