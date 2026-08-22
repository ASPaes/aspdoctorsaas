-- Histórico de módulos: registrar QUEM pediu, não o mensageiro.
--
-- A tela mostrava "Sincronização OEM" como autor de toda adição e todo
-- cancelamento de módulo de cliente com licença. Não é verdade: quem pediu foi
-- uma pessoa, logada, na ficha do cliente — o cron e a edge function só levam o
-- recado ao parceiro. O gatilho do histórico lê `auth.uid()`, e a escrita que
-- vem da edge function roda como `service_role`, que não tem um.
--
-- A fila já sabe quem foi: `oem_sync_fila.usuario_id` guarda o `auth.uid()` de
-- quem enfileirou, com o usuário presente. Faltava levá-lo até a escrita.
--
-- `fn_oem_fila_aplicar` passa a carimbar esse usuário na transação, e quem
-- registra autoria lê o carimbo quando não há sessão. Nada muda para a escrita
-- feita direto pela tela: ali `auth.uid()` existe e continua ganhando.

-- Fonte única da autoria. A sessão vem primeiro: um usuário logado nunca deve
-- ser confundido com o carimbo de outra operação. `current_setting(..., true)`
-- devolve NULL quando ninguém carimbou, em vez de estourar.
CREATE OR REPLACE FUNCTION public.fn_acting_user() RETURNS uuid
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public', 'extensions'
    AS $$
  SELECT coalesce(
    auth.uid(),
    nullif(current_setting('doctorsaas.acting_user', true), '')::uuid
  );
$$;

REVOKE ALL ON FUNCTION public.fn_acting_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_acting_user() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION "public"."trg_log_cliente_produto_modulo"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_acao    text;
  v_row     public.cliente_produto_modulos;
  v_qtd     numeric;
  v_motivo  text;
  v_nome    text;
  -- Escrita vinda da edge function roda como service_role e nao tem auth.uid():
  -- o historico ficava sem dono e a tela dizia "Sincronização OEM" para uma
  -- acao que uma pessoa mandou fazer. fn_acting_user() devolve quem enfileirou.
  v_uid     uuid := public.fn_acting_user();
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
      v_acao := 'quantidade';
      v_row := NEW;
      -- Mesma régua do cancelamento: o evento diz o que MUDOU. "Quantidade · 1"
      -- numa linha que foi de 2 para 3 é o que a pessoa procura; o total de 3
      -- ela já lê na ficha.
      v_qtd := coalesce(NEW.quantidade, 0) - coalesce(OLD.quantidade, 0);
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
$$;

CREATE OR REPLACE FUNCTION "public"."fn_oem_fila_aplicar"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  -- Quem pediu isto foi gente, na ficha do cliente; o cron e a edge function só
  -- entregam o recado. Sem este carimbo, tudo o que a linha escrever daqui para
  -- baixo — histórico de módulos, cancelado_por — nasce órfão, porque
  -- service_role não tem auth.uid(). Vale só nesta transação.
  IF v_l.usuario_id IS NOT NULL THEN
    PERFORM set_config('doctorsaas.acting_user', v_l.usuario_id::text, true);
  END IF;

  SELECT cp.cliente_id INTO v_cliente
    FROM public.cliente_produtos cp WHERE cp.id = v_l.cliente_produto_id;
  SELECT pm.nome INTO v_nome
    FROM public.produto_modulos pm WHERE pm.id = v_l.modulo_catalogo_id;

  v_dos_mod := public.fn_receita_vem_dos_modulos(v_l.cliente_produto_id);
  v_mensal  := coalesce(nullif(v_l.payload->>'vlr_mensal', '')::numeric, 0);

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
      nullif(v_l.payload->>'data', '')::date,
      nullif(v_l.payload->>'valor_downsell', '')::numeric
    );
    RETURN jsonb_build_object('aplicado', true, 'ficha', v_res);
  END IF;

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
           -- 22/08/2026: ativação digitada ao SOMAR quantidade é cobrança nova,
           -- então soma na linha em vez de ser descartada. Só o botão de
           -- adicionar manda `vlr_ativacao_somar`; a edição pelo lápis grava o
           -- valor direto na linha e não pode somar de novo.
           vlr_ativacao      = coalesce(vlr_ativacao, 0)
                               + coalesce(nullif(v_l.payload->>'vlr_ativacao_somar', '')::numeric, 0),
           updated_at        = now()
     WHERE id = v_l.modulo_linha_id;

    v_res := jsonb_build_object('quantidade_antes', v_antes, 'quantidade_depois', v_l.quantidade);
    v_novo := v_l.modulo_linha_id;

  ELSIF v_l.acao = 'ativar' THEN
    IF v_l.modulo_catalogo_id IS NULL THEN
      RETURN jsonb_build_object('aplicado', false, 'motivo', 'linha sem módulo do catálogo');
    END IF;
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
$$;

CREATE OR REPLACE FUNCTION "public"."fn_cancelar_modulo_aplicar"("p_id" "uuid", "p_quantidade" numeric DEFAULT NULL::numeric, "p_motivo" "text" DEFAULT NULL::"text", "p_motivo_id" bigint DEFAULT NULL::bigint, "p_data" "date" DEFAULT NULL::"date", "p_valor_downsell" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
           cancelado_em           = now(),
           cancelado_por          = coalesce(public.fn_acting_user(), v_row.cancelado_por),
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
           cancelado_em           = now(),
           cancelado_por          = coalesce(public.fn_acting_user(), v_row.cancelado_por),
           updated_at             = now()
     WHERE id = p_id;

    v_res := jsonb_build_object('cancelado', true, 'parcial', true,
                                'quantidade', v_cancel, 'restante', v_atual - v_cancel,
                                'data', v_data);
  END IF;

  -- O valor que sai do MRR. Informado pela tela quando ela sabe mais que a
  -- linha — que é o caso sempre que a venda virou movimento em vez de preço.
  -- Sem informação, cai na conta de antes.
  v_mensal := coalesce(p_valor_downsell, coalesce(v_row.vlr_mensal, 0) * v_cancel);

  IF NOT v_dos_mod AND v_mensal > 0 AND v_cliente IS NOT NULL THEN
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
    'valor_downsell', v_mensal,
    'receita_dos_modulos', v_dos_mod
  );
END;
$$;

-- CREATE OR REPLACE preserva privilégios; declarados para o arquivo se bastar.
GRANT EXECUTE ON FUNCTION public.trg_log_cliente_produto_modulo() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_oem_fila_aplicar(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_oem_fila_aplicar(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_cancelar_modulo_aplicar(uuid, numeric, text, bigint, date, numeric) TO service_role;
