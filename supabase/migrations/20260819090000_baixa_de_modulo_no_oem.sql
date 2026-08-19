-- ============================================================================
-- Preparo para dar baixa do módulo no OEM (não só na ficha).
--
-- Duas coisas faltavam:
--
-- 1. O CÓDIGO DO MÓDULO NO OEM. A ficha guarda o nome; a API do parceiro só
--    entende número. Ele já passa pela sincronização (vem no jsonb da filial),
--    mas era descartado — o único rastro era o texto "módulo #10" na descrição
--    do catálogo, e ler número de dentro de frase é como se perde integração.
--
-- 2. UM REGISTRO DAS TENTATIVAS. Escrita em sistema de terceiro sem log é
--    impossível de auditar depois: ninguém sabe o que foi enviado, o que
--    voltou, nem se a recusa foi do parceiro ou da nossa montagem.
-- ============================================================================

ALTER TABLE public.cliente_produto_modulos
  ADD COLUMN IF NOT EXISTS oem_modulo_codigo integer;

COMMENT ON COLUMN public.cliente_produto_modulos.oem_modulo_codigo IS
  'Código do módulo no catálogo do OEM. É por ele que a baixa é pedida ao parceiro.';

CREATE TABLE IF NOT EXISTS public.oem_baixa_modulo_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  cliente_produto_id  uuid,
  modulo_id           uuid,
  empresa_codigo      text,
  filial_codigo       text,
  oem_modulo_codigo   integer,
  quantidade_pedida   numeric,
  nova_quantidade     numeric,
  simulado            boolean NOT NULL DEFAULT false,
  ok                  boolean NOT NULL,
  http                integer,
  -- Resposta inteira do DoctorOEM, inclusive a recusa por campo faltando. É
  -- ela que diz se o problema foi nosso mapeamento ou o parceiro.
  resposta            jsonb,
  usuario_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oem_baixa_log_tenant
  ON public.oem_baixa_modulo_log (tenant_id, created_at DESC);

ALTER TABLE public.oem_baixa_modulo_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS oem_baixa_log_select ON public.oem_baixa_modulo_log;
CREATE POLICY oem_baixa_log_select ON public.oem_baixa_modulo_log
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR tenant_id = public.current_tenant_id());
-- Escrita só pela edge function (service_role): log que a tela edita não é log.

-- ============================================================================
-- A sincronização passa a gravar o código do módulo.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_oem_espelhar_modulos_no_contrato(
  p_tenant_id      uuid,
  p_filial_codigo  text,
  p_modulos        jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cp              record;
  v_m               record;
  v_modulo_id       uuid;
  v_chaves          text[];
  v_n               int;
  v_criados_catalogo int := 0;
  v_vinculados      int := 0;
  v_atualizados     int := 0;
  v_inativados      int := 0;
  v_apagados        int := 0;
BEGIN
  IF p_modulos IS NULL OR jsonb_typeof(p_modulos) <> 'array' THEN
    RETURN jsonb_build_object('ignorado', 'filial sem lista de módulos');
  END IF;

  PERFORM set_config('doctorsaas.skip_valor_sync', 'true', true);

  SELECT array_agg(DISTINCT public.fn_norm_nome_modulo(x.nome))
    INTO v_chaves
    FROM jsonb_to_recordset(p_modulos) AS x(nome text, ativo boolean)
   WHERE coalesce(x.ativo, true) = true AND coalesce(btrim(x.nome), '') <> '';

  FOR v_cp IN
    SELECT cp.id, cp.produto_id, cp.tenant_id
      FROM public.cliente_produtos cp
     WHERE cp.tenant_id = p_tenant_id
       AND cp.oem_codigo_filial = p_filial_codigo
  LOOP
    FOR v_m IN
      SELECT DISTINCT ON (public.fn_norm_nome_modulo(x.nome))
             btrim(x.nome)                     AS nome,
             public.fn_norm_nome_modulo(x.nome) AS chave,
             x.codigo                          AS codigo,
             greatest(coalesce(x.quantidade, 1), 1) AS quantidade,
             coalesce(x.valor_unitario, 0)     AS valor
        FROM jsonb_to_recordset(p_modulos)
             AS x(nome text, codigo int, ativo boolean,
                  quantidade numeric, valor_unitario numeric)
       WHERE coalesce(x.ativo, true) = true
         AND coalesce(btrim(x.nome), '') <> ''
       ORDER BY public.fn_norm_nome_modulo(x.nome), x.codigo
    LOOP
      SELECT m.id INTO v_modulo_id
        FROM public.produto_modulos m
       WHERE m.produto_id = v_cp.produto_id
         AND public.fn_norm_nome_modulo(m.nome) = v_m.chave
       ORDER BY m.created_at
       LIMIT 1;

      IF v_modulo_id IS NULL THEN
        INSERT INTO public.produto_modulos
          (tenant_id, produto_id, nome, descricao, ativo, vlr_custo, margem_percentual, vlr_venda)
        VALUES
          (v_cp.tenant_id, v_cp.produto_id, v_m.nome,
           'Importado do OEM · módulo #' || coalesce(v_m.codigo, 0), true, v_m.valor, 0, 0)
        RETURNING id INTO v_modulo_id;
        v_criados_catalogo := v_criados_catalogo + 1;
      END IF;

      UPDATE public.cliente_produto_modulos c
         SET quantidade        = coalesce(c.quantidade_manual, v_m.quantidade),
             vlr_custo         = v_m.valor,
             oem_modulo_codigo = v_m.codigo,
             ativo             = CASE WHEN c.cancelado_manual THEN c.ativo ELSE true END,
             data_inativacao   = CASE WHEN c.cancelado_manual THEN c.data_inativacao ELSE NULL END,
             updated_at        = now()
       WHERE c.cliente_produto_id = v_cp.id
         AND c.modulo_id = v_modulo_id
         AND c.origem = 'oem';
      GET DIAGNOSTICS v_n = ROW_COUNT;

      IF v_n > 0 THEN
        v_atualizados := v_atualizados + v_n;
      ELSIF NOT EXISTS (
        SELECT 1 FROM public.cliente_produto_modulos c
         WHERE c.cliente_produto_id = v_cp.id AND c.modulo_id = v_modulo_id
      ) THEN
        INSERT INTO public.cliente_produto_modulos
          (tenant_id, cliente_produto_id, modulo_id, quantidade,
           vlr_custo, vlr_mensal, ativo, origem, data_ativacao, oem_modulo_codigo)
        VALUES
          (v_cp.tenant_id, v_cp.id, v_modulo_id, v_m.quantidade,
           v_m.valor, 0, true, 'oem', current_date, v_m.codigo);
        v_vinculados := v_vinculados + 1;
      END IF;
    END LOOP;

    DELETE FROM public.cliente_produto_modulos c
     USING public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND c.cancelado_manual = false
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)))
       AND NOT EXISTS (
         SELECT 1 FROM public.movimentos_mrr mv WHERE mv.cliente_produto_modulo_id = c.id
       );
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_apagados := v_apagados + v_n;

    UPDATE public.cliente_produto_modulos c
       SET ativo = false, data_inativacao = current_date, updated_at = now()
      FROM public.produto_modulos m
     WHERE m.id = c.modulo_id
       AND c.cliente_produto_id = v_cp.id
       AND c.origem = 'oem'
       AND c.ativo
       AND (v_chaves IS NULL OR NOT (public.fn_norm_nome_modulo(m.nome) = ANY (v_chaves)));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_inativados := v_inativados + v_n;
  END LOOP;

  RETURN jsonb_build_object(
    'vinculados',       v_vinculados,
    'atualizados',      v_atualizados,
    'inativados',       v_inativados,
    'apagados',         v_apagados,
    'criados_catalogo', v_criados_catalogo
  );
END;
$fn$;

ALTER FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) TO service_role;

-- ============================================================================
-- Backfill do código: vem do próprio espelho, casando pelo nome normalizado —
-- a mesma regra que a sincronização usa. Sem isto, a baixa só funcionaria para
-- módulo tocado depois desta migration.
-- ============================================================================
UPDATE public.cliente_produto_modulos c
   SET oem_modulo_codigo = x.codigo
  FROM public.cliente_produtos cp
  JOIN public.oem_espelho_filial f
    ON f.tenant_id = cp.tenant_id AND f.filial_codigo = cp.oem_codigo_filial
  CROSS JOIN LATERAL jsonb_to_recordset(f.modulos) AS x(nome text, codigo int),
       -- `m` entra por vírgula, e o casamento com a linha alvo vai para o
       -- WHERE: dentro de um JOIN do FROM, a tabela sendo atualizada não pode
       -- ser referenciada.
       public.produto_modulos m
 WHERE cp.id = c.cliente_produto_id
   AND m.id = c.modulo_id
   AND c.origem = 'oem'
   AND c.oem_modulo_codigo IS NULL
   AND public.fn_norm_nome_modulo(x.nome) = public.fn_norm_nome_modulo(m.nome);
