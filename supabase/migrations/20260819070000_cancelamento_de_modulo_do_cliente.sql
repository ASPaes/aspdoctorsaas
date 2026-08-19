-- ============================================================================
-- Cancelar um módulo da licença pela ficha do cliente, com motivo e com
-- quantidade parcial.
--
-- O módulo espelhado do OEM é reescrito pela sincronização a cada carga. Sem
-- uma TRAVA, o cancelamento duraria até a próxima passada e o módulo voltaria
-- sozinho — e o operador não teria como saber por quê. Por isso:
--
--   `cancelado_manual`  = a sincronização nunca reativa esta linha.
--   `quantidade_manual` = a quantidade foi decidida aqui; a carga não a mexe.
--
-- A trava é necessária mesmo no dia em que o cancelamento também for enviado
-- ao parceiro: o espelho só volta em até 6 horas, e no meio do caminho a ficha
-- continuaria mostrando o módulo ativo.
--
-- O que esta migration NÃO faz: dar baixa no OEM. A rota existe
-- (`POST licenciamento/minhaslicencas/saveFilial`), mas ela salva a FILIAL
-- INTEIRA e exige `codigoTipoNegocio`, `codigoDetalhesTipoNegocio` e
-- `codigoOrigemVenda` — três campos que nenhuma rota de leitura que usamos
-- devolve. Mandar sem eles pode zerar o tipo de negócio e a origem da venda da
-- licença no parceiro. Enquanto não houver como lê-los, o cancelamento vale
-- aqui e o corte no portal continua manual.
-- ============================================================================

ALTER TABLE public.cliente_produto_modulos
  ADD COLUMN IF NOT EXISTS cancelado_manual    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancelamento_motivo text,
  ADD COLUMN IF NOT EXISTS cancelado_em        timestamptz,
  ADD COLUMN IF NOT EXISTS cancelado_por       uuid,
  ADD COLUMN IF NOT EXISTS quantidade_manual   numeric;

COMMENT ON COLUMN public.cliente_produto_modulos.cancelado_manual IS
  'true = cancelado na ficha; a sincronização do OEM não reativa.';
COMMENT ON COLUMN public.cliente_produto_modulos.quantidade_manual IS
  'Quantidade decidida na ficha (cancelamento parcial). Quando preenchida, a sincronização do OEM não altera a quantidade.';

ALTER TABLE public.cliente_produto_modulo_eventos
  ADD COLUMN IF NOT EXISTS motivo text;

-- ============================================================================
-- O gatilho do histórico passa a reconhecer o cancelamento e a guardar o
-- motivo. A ordem das perguntas importa: cancelamento parcial também mexe na
-- quantidade, e sem checar o carimbo primeiro ele viraria "Quantidade".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_log_cliente_produto_modulo() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $trg$
DECLARE
  v_acao    text;
  v_row     public.cliente_produto_modulos;
  v_qtd     numeric;
  v_motivo  text;
  v_nome    text;
  v_uid     uuid := auth.uid();
  v_usuario text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_acao := 'adicionado'; v_row := NEW; v_qtd := NEW.quantidade;
  ELSIF TG_OP = 'DELETE' THEN
    v_acao := 'removido';   v_row := OLD; v_qtd := OLD.quantidade;
  ELSE
    IF NEW.cancelado_em IS DISTINCT FROM OLD.cancelado_em AND NEW.cancelado_em IS NOT NULL THEN
      v_acao := 'cancelado';
      v_row := NEW;
      v_motivo := NEW.cancelamento_motivo;
      -- No evento, `quantidade` é QUANTO FOI CANCELADO, não o que sobrou:
      -- "Cancelado · 1" numa linha que tinha 2 é o que a pessoa procura.
      v_qtd := CASE
                 WHEN NEW.ativo = false THEN coalesce(OLD.quantidade, 0)
                 ELSE greatest(coalesce(OLD.quantidade, 0) - coalesce(NEW.quantidade, 0), 0)
               END;
    ELSIF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
      v_acao := CASE WHEN NEW.ativo THEN 'reativado' ELSE 'cancelado' END;
      v_row := NEW; v_qtd := NEW.quantidade; v_motivo := NEW.cancelamento_motivo;
    ELSIF NEW.quantidade IS DISTINCT FROM OLD.quantidade THEN
      v_acao := 'quantidade'; v_row := NEW; v_qtd := NEW.quantidade;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  SELECT m.nome INTO v_nome FROM public.produto_modulos m WHERE m.id = v_row.modulo_id;

  IF v_uid IS NOT NULL THEN
    SELECT f.nome INTO v_usuario
      FROM public.profiles p
      LEFT JOIN public.funcionarios f ON f.id = p.funcionario_id
     WHERE p.user_id = v_uid
     LIMIT 1;
  END IF;

  INSERT INTO public.cliente_produto_modulo_eventos
    (tenant_id, cliente_produto_id, modulo_id, modulo_nome, acao, quantidade,
     vlr_custo, vlr_mensal, origem, usuario_id, usuario_nome, motivo)
  VALUES
    (v_row.tenant_id, v_row.cliente_produto_id, v_row.modulo_id,
     coalesce(v_nome, '(módulo sem cadastro)'), v_acao, v_qtd,
     v_row.vlr_custo, v_row.vlr_mensal, coalesce(v_row.origem, 'manual'),
     v_uid, v_usuario, v_motivo);

  RETURN NULL;
END;
$trg$;

-- ============================================================================
-- A ação da tela. Vale para módulo do OEM e para módulo digitado à mão.
--   p_quantidade NULL ou >= a atual  → cancela a linha inteira
--   p_quantidade menor               → só reduz, e a linha continua ativa
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_cancelar_modulo_cliente(
  p_id         uuid,
  p_quantidade numeric DEFAULT NULL,
  p_motivo     text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row    public.cliente_produto_modulos;
  v_atual  numeric;
  v_cancel numeric;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
BEGIN
  SELECT * INTO v_row FROM public.cliente_produto_modulos WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Módulo não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  -- Mesmo portão das policies da tabela: dono do tenant (ou super admin) e
  -- admin/head. coalesce porque helper que devolve NULL faria o IF nunca
  -- disparar — o portão passaria a liberar.
  IF NOT (
    (v_row.tenant_id = public.current_tenant_id() OR coalesce(public.is_super_admin(), false))
    AND coalesce(public.is_admin_or_head(), false)
  ) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar módulo deste cliente.' USING ERRCODE = '42501';
  END IF;

  IF v_row.ativo = false THEN
    RAISE EXCEPTION 'Este módulo já está cancelado.' USING ERRCODE = '22023';
  END IF;

  v_atual  := greatest(coalesce(v_row.quantidade, 1), 1);
  v_cancel := least(greatest(coalesce(p_quantidade, v_atual), 1), v_atual);

  IF v_cancel >= v_atual THEN
    UPDATE public.cliente_produto_modulos
       SET ativo               = false,
           data_inativacao     = current_date,
           cancelado_manual    = true,
           cancelamento_motivo = v_motivo,
           cancelado_em        = now(),
           cancelado_por       = auth.uid(),
           updated_at          = now()
     WHERE id = p_id;

    RETURN jsonb_build_object('cancelado', true, 'parcial', false, 'quantidade', v_cancel);
  END IF;

  -- Parcial: sobra o que não foi cancelado, e a quantidade passa a ser decidida
  -- aqui — senão a próxima carga do OEM devolveria a quantidade antiga.
  UPDATE public.cliente_produto_modulos
     SET quantidade          = v_atual - v_cancel,
         quantidade_manual   = v_atual - v_cancel,
         cancelamento_motivo = v_motivo,
         cancelado_em        = now(),
         cancelado_por       = auth.uid(),
         updated_at          = now()
   WHERE id = p_id;

  RETURN jsonb_build_object('cancelado', true, 'parcial', true,
                            'quantidade', v_cancel, 'restante', v_atual - v_cancel);
END;
$fn$;

ALTER FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_cliente(uuid, numeric, text)
  TO authenticated, service_role;

-- ============================================================================
-- A sincronização passa a respeitar as duas travas.
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
  v_travados        int := 0;
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

      -- Linha cancelada na ficha NÃO volta: o custo continua sendo atualizado
      -- (o parceiro segue cobrando enquanto não der baixa), mas `ativo` e a
      -- quantidade travada ficam como a pessoa deixou.
      UPDATE public.cliente_produto_modulos c
         SET quantidade      = coalesce(c.quantidade_manual, v_m.quantidade),
             vlr_custo       = v_m.valor,
             ativo           = CASE WHEN c.cancelado_manual THEN c.ativo ELSE true END,
             data_inativacao = CASE WHEN c.cancelado_manual THEN c.data_inativacao ELSE NULL END,
             updated_at      = now()
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
           vlr_custo, vlr_mensal, ativo, origem, data_ativacao)
        VALUES
          (v_cp.tenant_id, v_cp.id, v_modulo_id, v_m.quantidade,
           v_m.valor, 0, true, 'oem', current_date);
        v_vinculados := v_vinculados + 1;
      END IF;
    END LOOP;

    -- Sobra sem uso é apagada — MENOS a que foi cancelada aqui: essa é decisão
    -- registrada, com motivo e autor, e some junto com o resto do histórico.
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

    SELECT count(*) INTO v_n
      FROM public.cliente_produto_modulos c
     WHERE c.cliente_produto_id = v_cp.id
       AND (c.cancelado_manual OR c.quantidade_manual IS NOT NULL);
    v_travados := v_travados + v_n;
  END LOOP;

  RETURN jsonb_build_object(
    'vinculados',       v_vinculados,
    'atualizados',      v_atualizados,
    'inativados',       v_inativados,
    'apagados',         v_apagados,
    'travados',         v_travados,
    'criados_catalogo', v_criados_catalogo
  );
END;
$fn$;

ALTER FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_espelhar_modulos_no_contrato(uuid, text, jsonb) TO service_role;
