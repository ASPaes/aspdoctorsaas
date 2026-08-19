-- ============================================================================
-- OEM › Módulos: vincular produto do catálogo do parceiro a um produto do
-- DoctorSaaS e trazer a lista de módulos dele para dentro de produto_modulos.
--
-- Por que RPC e não escrita direta da tela: o "upgrade" é um conjunto de 4
-- passos que precisam cair juntos (casar por nome, criar o que falta, apagar a
-- sobra sem uso, inativar a sobra em uso). Meia importação deixa o catálogo do
-- produto num estado que ninguém consegue explicar depois.
--
-- A restrição que desenha tudo: produto_modulos.id é referenciado por
-- cliente_produto_modulos, contrato_itens e onboarding_journey_modules, e
-- NENHUMA das três tem ON DELETE. "Limpar os módulos" no sentido literal
-- falharia com erro de FK no primeiro produto que já tem cliente — por isso
-- módulo em uso é INATIVADO, nunca apagado, e módulo de mesmo nome é
-- REAPROVEITADO (o cliente continua apontando para a mesma linha).
-- ============================================================================

-- Casar por nome só funciona se "Gestão" e "gestao " forem a mesma coisa. Sem
-- isto, o módulo que o cliente já usa fica inativado e uma cópia acentuada
-- nasce ao lado — exatamente a duplicata que o upgrade existe para evitar.
-- Não usa unaccent: a extensão não está instalada no projeto.
CREATE OR REPLACE FUNCTION public.fn_norm_nome_modulo(p_nome text) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $norm$
  SELECT regexp_replace(
           lower(translate(btrim(coalesce(p_nome, '')),
             'áàâãäéèêëíìîïóòôõöúùûüñçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÑÇ',
             'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
           '\s+', ' ', 'g')
$norm$;

REVOKE ALL ON FUNCTION public.fn_norm_nome_modulo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_norm_nome_modulo(text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.oem_produto_vinculo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- O vínculo é POR CONTA CONECTADA, não por tenant: a grade de preços do OEM
  -- vem por conta (cada unidade tem a sua) e o mesmo módulo custa diferente em
  -- cada uma. Um de-para único no tenant teria que escolher de qual conta
  -- puxar o custo — e essa escolha não tem resposta certa.
  conta_integration_id  uuid NOT NULL REFERENCES public.oem_integration(id) ON DELETE CASCADE,
  produto_codigo        text NOT NULL,
  produto_nome          text,          -- rótulo do produto no OEM na hora do vínculo
  produto_id            bigint NOT NULL REFERENCES public.produtos(id) ON DELETE CASCADE,
  ultimo_upgrade_em     timestamptz,
  ultimo_upgrade_resumo jsonb,
  criado_em             timestamptz NOT NULL DEFAULT now(),
  atualizado_em         timestamptz NOT NULL DEFAULT now(),
  criado_por            uuid,
  CONSTRAINT oem_produto_vinculo_uniq_oem UNIQUE (conta_integration_id, produto_codigo),
  CONSTRAINT oem_produto_vinculo_uniq_ds  UNIQUE (conta_integration_id, produto_id)
);

CREATE INDEX IF NOT EXISTS idx_oem_produto_vinculo_tenant
  ON public.oem_produto_vinculo (tenant_id, conta_integration_id);

ALTER TABLE public.oem_produto_vinculo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oem_produto_vinculo_select ON public.oem_produto_vinculo;
CREATE POLICY oem_produto_vinculo_select ON public.oem_produto_vinculo
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id());

-- Escrita só por admin/head. A tela vincula pela RPC; o DELETE direto existe
-- para desvincular — e desvincular não mexe em módulo nenhum.
DROP POLICY IF EXISTS oem_produto_vinculo_delete ON public.oem_produto_vinculo;
CREATE POLICY oem_produto_vinculo_delete ON public.oem_produto_vinculo
  FOR DELETE TO authenticated
  USING ((public.is_super_admin() OR tenant_id = public.current_tenant_id())
         AND public.is_admin_or_head());

-- ============================================================================
-- fn_oem_vincular_produto
--   p_upgrade = false   -> só grava o de-para, não toca em módulo nenhum
--   p_upgrade = true    -> sincroniza produto_modulos com a coluna do OEM
--   p_somente_com_valor -> ignora os módulos zerados na grade
-- Devolve jsonb com o que aconteceu, para a tela mostrar número e não "ok".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_vincular_produto(
  p_conta_integration_id uuid,
  p_produto_codigo       text,
  p_produto_id           bigint,
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
  v_total_oem      int := 0;
  v_criados        int := 0;
  v_atualizados    int := 0;
  v_apagados       int := 0;
  v_inativados     int := 0;
  v_resumo         jsonb;
BEGIN
  -- coalesce porque helper de permissão que devolve NULL faz o IF NOT (...)
  -- nunca disparar: o portão passaria a liberar em vez de barrar.
  IF NOT coalesce(public.is_admin_or_head(), false) THEN
    RAISE EXCEPTION 'Sem permissão para vincular produtos do OEM.' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.oem_integration WHERE id = p_conta_integration_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Conta OEM não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT coalesce(public.is_super_admin(), false)
     AND v_tenant IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'Esta conta OEM é de outro tenant.' USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id INTO v_produto_tenant FROM public.produtos WHERE id = p_produto_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto do DoctorSaaS não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_produto_tenant IS NOT NULL AND v_produto_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'O produto escolhido é de outro tenant.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.oem_espelho_modulo_preco
     WHERE conta_integration_id = p_conta_integration_id
       AND produto_codigo = p_produto_codigo
  ) THEN
    RAISE EXCEPTION 'O produto % não está na grade de preços desta conta. Atualize o espelho.', p_produto_codigo
      USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.oem_produto_vinculo
     WHERE conta_integration_id = p_conta_integration_id
       AND produto_id = p_produto_id
       AND produto_codigo <> p_produto_codigo
  ) THEN
    RAISE EXCEPTION 'Este produto do DoctorSaaS já está vinculado a outro produto do OEM nesta conta.'
      USING ERRCODE = '23505';
  END IF;

  SELECT produto_nome INTO v_nome_oem
    FROM public.oem_espelho_modulo_preco
   WHERE conta_integration_id = p_conta_integration_id
     AND produto_codigo = p_produto_codigo
   LIMIT 1;

  INSERT INTO public.oem_produto_vinculo
    (tenant_id, conta_integration_id, produto_codigo, produto_nome, produto_id, criado_por)
  VALUES
    (v_tenant, p_conta_integration_id, p_produto_codigo,
     coalesce(v_nome_oem, p_produto_codigo), p_produto_id, auth.uid())
  ON CONFLICT (conta_integration_id, produto_codigo) DO UPDATE
    SET produto_id    = EXCLUDED.produto_id,
        produto_nome  = EXCLUDED.produto_nome,
        atualizado_em = now();

  IF NOT p_upgrade THEN
    RETURN jsonb_build_object('upgrade', false, 'vinculado', true);
  END IF;

  -- A lista do OEM é lida deduplicada por nome normalizado: dois módulos do
  -- catálogo com o mesmo nome viram um só do lado de cá, senão o segundo
  -- entraria como duplicata invisível na tela de Produtos e módulos.
  DROP TABLE IF EXISTS _oem_mods;
  CREATE TEMP TABLE _oem_mods ON COMMIT DROP AS
    SELECT DISTINCT ON (public.fn_norm_nome_modulo(p.modulo_nome))
           public.fn_norm_nome_modulo(p.modulo_nome)   AS chave,
           btrim(p.modulo_nome)          AS nome,
           p.modulo_codigo               AS modulo_codigo,
           coalesce(p.valor_unitario, 0) AS valor
      FROM public.oem_espelho_modulo_preco p
     WHERE p.conta_integration_id = p_conta_integration_id
       AND p.produto_codigo = p_produto_codigo
       AND (NOT p_somente_com_valor OR coalesce(p.valor_unitario, 0) > 0)
     ORDER BY public.fn_norm_nome_modulo(p.modulo_nome), p.modulo_codigo;

  SELECT count(*) INTO v_total_oem FROM _oem_mods;

  -- 1) Reaproveita o que já existe com o mesmo nome. Só o custo é atualizado:
  --    margem e preço de venda são decisão comercial, não vêm do parceiro.
  WITH alvo AS (
    SELECT DISTINCT ON (public.fn_norm_nome_modulo(m.nome))
           m.id, public.fn_norm_nome_modulo(m.nome) AS chave
      FROM public.produto_modulos m
     WHERE m.produto_id = p_produto_id
     ORDER BY public.fn_norm_nome_modulo(m.nome), m.created_at
  )
  UPDATE public.produto_modulos m
     SET vlr_custo  = o.valor,
         ativo      = true,
         updated_at = now()
    FROM _oem_mods o
    JOIN alvo a ON a.chave = o.chave
   WHERE m.id = a.id;
  GET DIAGNOSTICS v_atualizados = ROW_COUNT;

  -- 2) Cria o que o produto ainda não tem.
  INSERT INTO public.produto_modulos
    (tenant_id, produto_id, nome, descricao, ativo, vlr_custo, margem_percentual, vlr_venda)
  SELECT v_tenant, p_produto_id, o.nome,
         'Importado do OEM · módulo #' || o.modulo_codigo,
         true, o.valor, 0, 0
    FROM _oem_mods o
   WHERE NOT EXISTS (
     SELECT 1 FROM public.produto_modulos m
      WHERE m.produto_id = p_produto_id
        AND public.fn_norm_nome_modulo(m.nome) = o.chave
   );
  GET DIAGNOSTICS v_criados = ROW_COUNT;

  -- 3) Sobra (módulo do produto que o OEM não tem) que NINGUÉM usa: apaga.
  DELETE FROM public.produto_modulos m
   WHERE m.produto_id = p_produto_id
     AND NOT EXISTS (SELECT 1 FROM _oem_mods o WHERE o.chave = public.fn_norm_nome_modulo(m.nome))
     AND NOT EXISTS (SELECT 1 FROM public.cliente_produto_modulos c WHERE c.modulo_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.contrato_itens ci WHERE ci.modulo_id = m.id)
     AND NOT EXISTS (SELECT 1 FROM public.onboarding_journey_modules j WHERE j.produto_modulo_id = m.id);
  GET DIAGNOSTICS v_apagados = ROW_COUNT;

  -- 4) O que sobrou da sobra está em uso por cliente, contrato ou jornada:
  --    apagar quebraria a FK e sumiria com o histórico. Só sai de circulação.
  UPDATE public.produto_modulos m
     SET ativo = false, updated_at = now()
   WHERE m.produto_id = p_produto_id
     AND m.ativo
     AND NOT EXISTS (SELECT 1 FROM _oem_mods o WHERE o.chave = public.fn_norm_nome_modulo(m.nome));
  GET DIAGNOSTICS v_inativados = ROW_COUNT;

  v_resumo := jsonb_build_object(
    'upgrade',     true,
    'vinculado',   true,
    'total_oem',   v_total_oem,
    'criados',     v_criados,
    'atualizados', v_atualizados,
    'apagados',    v_apagados,
    'inativados',  v_inativados
  );

  UPDATE public.oem_produto_vinculo
     SET ultimo_upgrade_em = now(),
         ultimo_upgrade_resumo = v_resumo,
         atualizado_em = now()
   WHERE conta_integration_id = p_conta_integration_id
     AND produto_codigo = p_produto_codigo;

  DROP TABLE IF EXISTS _oem_mods;
  RETURN v_resumo;
END;
$fn$;

ALTER FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint, boolean, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint, boolean, boolean)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.fn_oem_vincular_produto(uuid, text, bigint, boolean, boolean) IS
  'Vincula um produto do catálogo do OEM a um produto do DoctorSaaS. Com p_upgrade, sincroniza produto_modulos com a coluna do OEM: casa por nome (atualiza vlr_custo), cria o que falta, apaga a sobra sem uso e inativa a sobra em uso.';
