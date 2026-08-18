-- 18/08/2026 — as 7 funcoes que o conserto do is_super_admin() nao alcancou.
--
-- 20260818010000_is_super_admin_nunca_devolve_null.sql fechou ~44 portoes de uma
-- vez, mas nao estes. Aqui o NULL nao vem do helper, vem da OUTRA metade da
-- condicao:
--
--     SELECT p.role INTO v_role FROM profiles WHERE user_id = auth.uid();
--     IF v_role NOT IN ('admin','head') AND NOT public.is_super_admin() THEN raise
--
-- Sem linha em profiles, v_role fica NULL e "NULL NOT IN ('admin','head')" ja e
-- NULL por conta propria. NULL AND TRUE = NULL, o IF nao dispara, o raise nunca
-- acontece. Consertar o helper nao ajuda: a expressao continua NULL.
--
-- Medido no Postgres local, com o helper JA corrigido (o estado de producao
-- agora) e a versao de PRODUCAO das funcoes carregada: usuario autenticado sem
-- linha em profiles chamou soft_delete_ticket num ticket de OUTRO tenant e o
-- deleted_at foi carimbado. Com esta migration, o mesmo caso volta
-- "Apenas admin ou head podem excluir tickets." e o admin legitimo do tenant
-- continua excluindo normalmente.
--
-- set_group_monitor merece nota: o autor JA tinha escrito COALESCE(v_is_sa,false)
-- -- estava ciente do hazard -- e mesmo assim caiu no v_role da mesma linha. E a
-- prova de que consertar so o helper da falsa sensacao de fim.
--
-- O padrao correto ja existe no repo, em link_cliente_to_attendance:
--     IF v_caller_role IS NULL OR v_caller_role NOT IN ('admin','head','user',...)
-- Aqui usei coalesce(v_role,'') por ser a alteracao de UMA linha em cada funcao,
-- sem reescrever a condicao.
--
-- Corpo identico ao de producao (extraido do dump). A unica diferenca em cada uma
-- das 7 e a linha do portao -- conferido: 1 linha alterada por funcao.
-- CREATE OR REPLACE sem DROP: assinaturas inalteradas, GRANTs sobrevivem.

CREATE OR REPLACE FUNCTION "public"."aplicar_reajuste"("p_reajuste_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id uuid; v_tenant_id uuid; v_role text; v_status text; r record;
  v_pct numeric; v_mrr_id uuid; v_evento_id uuid; v_nova_data_reajuste date;
  v_total_aplicados integer := 0;
BEGIN
  v_user_id := auth.uid();
  SELECT r2.tenant_id, r2.status INTO v_tenant_id, v_status FROM reajustes r2 WHERE r2.id = p_reajuste_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Reajuste não encontrado'; END IF;
  IF v_status != 'pendente' THEN RAISE EXCEPTION 'Reajuste já foi aplicado ou estornado'; END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.user_id = v_user_id AND p.tenant_id = v_tenant_id;
  IF coalesce(v_role, '') NOT IN ('admin','head') AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'Sem permissão para aplicar reajustes'; END IF;

  FOR r IN SELECT * FROM reajuste_contratos WHERE reajuste_id = p_reajuste_id AND selecionado = true
  LOOP
    v_pct := r.percentual_aplicado;

    v_nova_data_reajuste := (SELECT COALESCE(data_proximo_reajuste, CURRENT_DATE) + interval '12 months'
                             FROM contratos WHERE id = r.contrato_id);

    UPDATE contratos SET data_proximo_reajuste = v_nova_data_reajuste, updated_at = now()
    WHERE id = r.contrato_id;

    UPDATE cliente_produtos cp SET data_proximo_reajuste = v_nova_data_reajuste
    FROM contrato_itens ci2 WHERE ci2.contrato_id = r.contrato_id
      AND cp.id = ci2.cliente_produto_id AND ci2.cliente_produto_id IS NOT NULL;

    INSERT INTO movimentos_mrr (cliente_id, tipo, data_movimento, valor_delta, descricao, tenant_id, contrato_id, status)
    VALUES (r.cliente_id, 'reajuste'::movimento_mrr_tipo, CURRENT_DATE, r.vlr_delta,
      'Reajuste de ' || v_pct || '% sobre MRR atual R$ ' || r.vlr_mensal_antes,
      v_tenant_id, r.contrato_id, 'ativo')
    RETURNING id INTO v_mrr_id;

    INSERT INTO contrato_eventos (tenant_id, contrato_id, cliente_id, acao, data_acao, usuario_id,
      mensalidade_contrato_snapshot, movimento_mrr_id, observacao)
    VALUES (v_tenant_id, r.contrato_id, r.cliente_id, 'reajuste', CURRENT_DATE, v_user_id,
      r.vlr_mensal_depois, v_mrr_id,
      'Reajuste ' || v_pct || '% — de R$ ' || r.vlr_mensal_antes || ' para R$ ' || r.vlr_mensal_depois)
    RETURNING id INTO v_evento_id;

    UPDATE reajuste_contratos SET movimento_mrr_id = v_mrr_id, contrato_evento_id = v_evento_id WHERE id = r.id;

    -- PEÇA 2 (gatilho explícito): enfileira o contrato para sincronizar com o Omie.
    -- enfileirar_sync_omie respeita a flag sync_automatica_ativa (não faz nada se desligada).
    -- Atômico com o reajuste (mesma transação): se der rollback, o enfileiramento some junto.
    PERFORM public.enfileirar_sync_omie(r.contrato_id, 'reajuste');

    v_total_aplicados := v_total_aplicados + 1;
  END LOOP;

  UPDATE reajustes SET status = 'aplicado', updated_at = now() WHERE id = p_reajuste_id;
  RETURN jsonb_build_object('success', true, 'contratos_aplicados', v_total_aplicados);
END;
$_$;



CREATE OR REPLACE FUNCTION "public"."atualizar_reajuste_item"("p_item_id" "uuid", "p_percentual" numeric DEFAULT NULL::numeric, "p_selecionado" boolean DEFAULT NULL::boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_reajuste_id uuid;
  v_tenant_id uuid;
  v_role text;
  v_status text;
  v_totais record;
BEGIN
  v_user_id := auth.uid();

  SELECT rc.reajuste_id, r.tenant_id, r.status
  INTO v_reajuste_id, v_tenant_id, v_status
  FROM reajuste_contratos rc
  JOIN reajustes r ON r.id = rc.reajuste_id
  WHERE rc.id = p_item_id;

  IF v_reajuste_id IS NULL THEN
    RAISE EXCEPTION 'Item de reajuste não encontrado';
  END IF;

  IF v_status != 'pendente' THEN
    RAISE EXCEPTION 'Só é possível editar reajustes pendentes';
  END IF;

  SELECT p.role INTO v_role FROM profiles p WHERE p.user_id = v_user_id AND p.tenant_id = v_tenant_id;
  IF coalesce(v_role, '') NOT IN ('admin', 'head') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;

  IF p_percentual IS NOT NULL THEN
    UPDATE reajuste_contratos SET
      percentual_aplicado = p_percentual,
      vlr_delta = ROUND(vlr_mensal_antes * p_percentual / 100, 2),
      vlr_mensal_depois = ROUND(vlr_mensal_antes * (1 + p_percentual / 100), 2)
    WHERE id = p_item_id;
  END IF;

  IF p_selecionado IS NOT NULL THEN
    UPDATE reajuste_contratos SET selecionado = p_selecionado
    WHERE id = p_item_id;
  END IF;

  SELECT
    count(*) FILTER (WHERE selecionado) AS qtd,
    COALESCE(SUM(vlr_mensal_antes) FILTER (WHERE selecionado), 0) AS total_antes,
    COALESCE(SUM(vlr_delta) FILTER (WHERE selecionado), 0) AS total_delta,
    COALESCE(SUM(vlr_mensal_depois) FILTER (WHERE selecionado), 0) AS total_depois
  INTO v_totais
  FROM reajuste_contratos
  WHERE reajuste_id = v_reajuste_id;

  UPDATE reajustes SET
    qtd_contratos = v_totais.qtd,
    vlr_mensal_total_antes = ROUND(v_totais.total_antes, 2),
    vlr_reajuste_total = ROUND(v_totais.total_delta, 2),
    vlr_mensal_total_depois = ROUND(v_totais.total_depois, 2),
    updated_at = now()
  WHERE id = v_reajuste_id;

  RETURN jsonb_build_object(
    'qtd_contratos', v_totais.qtd,
    'vlr_mensal_total_antes', ROUND(v_totais.total_antes, 2),
    'vlr_reajuste_total', ROUND(v_totais.total_delta, 2),
    'vlr_mensal_total_depois', ROUND(v_totais.total_depois, 2)
  );
END;
$$;



CREATE OR REPLACE FUNCTION "public"."estornar_reajuste"("p_reajuste_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id uuid; v_tenant_id uuid; v_role text; v_status text; r record;
  v_estorno_mrr_id uuid; v_total_estornados integer := 0;
BEGIN
  v_user_id := auth.uid();
  SELECT r2.tenant_id, r2.status INTO v_tenant_id, v_status FROM reajustes r2 WHERE r2.id = p_reajuste_id;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Reajuste não encontrado'; END IF;
  IF v_status != 'aplicado' THEN RAISE EXCEPTION 'Apenas reajustes aplicados podem ser estornados'; END IF;
  SELECT p.role INTO v_role FROM profiles p WHERE p.user_id = v_user_id AND p.tenant_id = v_tenant_id;
  IF coalesce(v_role, '') NOT IN ('admin','head') AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'Sem permissão'; END IF;

  FOR r IN SELECT * FROM reajuste_contratos WHERE reajuste_id = p_reajuste_id AND selecionado = true
  LOOP
    UPDATE contratos SET data_proximo_reajuste = r.data_proximo_reajuste_antes, updated_at = now()
    WHERE id = r.contrato_id;

    UPDATE cliente_produtos cp SET data_proximo_reajuste = r.data_proximo_reajuste_antes
    FROM contrato_itens ci WHERE ci.contrato_id = r.contrato_id
      AND cp.id = ci.cliente_produto_id AND ci.cliente_produto_id IS NOT NULL;

    IF r.movimento_mrr_id IS NOT NULL THEN
      INSERT INTO movimentos_mrr (cliente_id, tipo, data_movimento, valor_delta, descricao, tenant_id, contrato_id, status, estorno_de)
      VALUES (r.cliente_id, 'reajuste'::movimento_mrr_tipo, CURRENT_DATE, -r.vlr_delta,
        'Estorno de reajuste — reversão de R$ ' || r.vlr_delta,
        v_tenant_id, r.contrato_id, 'ativo', r.movimento_mrr_id)
      RETURNING id INTO v_estorno_mrr_id;
      UPDATE movimentos_mrr SET estornado_por = v_estorno_mrr_id WHERE id = r.movimento_mrr_id;
    END IF;

    IF r.contrato_evento_id IS NOT NULL THEN DELETE FROM contrato_eventos WHERE id = r.contrato_evento_id; END IF;

    -- CORRECAO: simetrico ao aplicar_reajuste. Sem isto, o estorno reverte o DS e o Omie fica
    -- com o valor reajustado (divergencia silenciosa: cliente segue cobrado pelo valor errado).
    -- enfileirar_sync_omie respeita sync_automatica_ativa/integracao_pausada; atomico na mesma transacao.
    PERFORM public.enfileirar_sync_omie(r.contrato_id, 'estorno_reajuste');

    v_total_estornados := v_total_estornados + 1;
  END LOOP;

  UPDATE reajustes SET status = 'estornado', updated_at = now() WHERE id = p_reajuste_id;
  RETURN jsonb_build_object('success', true, 'contratos_estornados', v_total_estornados);
END;
$_$;



CREATE OR REPLACE FUNCTION "public"."preparar_reajuste"("p_tenant_id" "uuid", "p_periodo_inicio" "date", "p_periodo_fim" "date", "p_percentual" numeric, "p_unidade_base_id" bigint DEFAULT NULL::bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid; v_role text; v_reajuste_id uuid; v_qtd integer;
  v_total_antes numeric := 0; v_total_delta numeric := 0; v_total_depois numeric := 0;
  r record; v_snapshot jsonb; v_n_contratos integer; v_base numeric;
BEGIN
  v_user_id := auth.uid();
  SELECT p.role INTO v_role FROM profiles p WHERE p.user_id = v_user_id AND p.tenant_id = p_tenant_id;
  IF coalesce(v_role, '') NOT IN ('admin','head') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas admin ou head podem criar reajustes';
  END IF;

  INSERT INTO reajustes (tenant_id, usuario_id, periodo_inicio, periodo_fim, percentual_padrao)
  VALUES (p_tenant_id, v_user_id, p_periodo_inicio, p_periodo_fim, p_percentual)
  RETURNING id INTO v_reajuste_id;

  FOR r IN
    SELECT c.id AS contrato_id, c.cliente_id, c.data_proximo_reajuste
    FROM contratos c JOIN clientes cl ON cl.id = c.cliente_id
    WHERE c.tenant_id = p_tenant_id AND c.status = 'ativo'
      AND c.data_proximo_reajuste IS NOT NULL
      AND c.data_proximo_reajuste >= p_periodo_inicio
      AND c.data_proximo_reajuste <= p_periodo_fim
      AND (p_unidade_base_id IS NULL OR cl.unidade_base_id = p_unidade_base_id)
  LOOP
    SELECT COUNT(*) INTO v_n_contratos
    FROM contratos cc WHERE cc.cliente_id = r.cliente_id AND cc.status = 'ativo';

    IF v_n_contratos = 1 THEN
      v_base := COALESCE((SELECT SUM(cp.vlr_mensal) FROM cliente_produtos cp
                          WHERE cp.cliente_id = r.cliente_id AND cp.ativo = true), 0)
              + COALESCE((SELECT SUM(m.valor_delta) FROM movimentos_mrr m
                          WHERE m.cliente_id = r.cliente_id AND m.status = 'ativo'
                            AND m.estornado_por IS NULL AND m.estorno_de IS NULL
                            AND m.tipo NOT IN ('venda_avulsa','churn','reactivation')), 0);
    ELSE
      v_base := COALESCE((SELECT SUM(cp.vlr_mensal)
                          FROM (SELECT DISTINCT ci.cliente_produto_id FROM contrato_itens ci
                                WHERE ci.contrato_id = r.contrato_id AND ci.cliente_produto_id IS NOT NULL) d
                          JOIN cliente_produtos cp ON cp.id = d.cliente_produto_id AND cp.ativo = true), 0);
    END IF;

    SELECT jsonb_build_object(
      'contrato_itens', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', ci.id, 'cliente_produto_id', ci.cliente_produto_id, 'vlr_mensal', ci.vlr_mensal))
        FROM contrato_itens ci WHERE ci.contrato_id = r.contrato_id), '[]'::jsonb),
      'cliente_produtos', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object('id', cp.id, 'vlr_mensal', cp.vlr_mensal))
        FROM contrato_itens ci2 JOIN cliente_produtos cp ON cp.id = ci2.cliente_produto_id
        WHERE ci2.contrato_id = r.contrato_id AND ci2.cliente_produto_id IS NOT NULL), '[]'::jsonb),
      'mrr_atual_base', v_base
    ) INTO v_snapshot;

    INSERT INTO reajuste_contratos (
      reajuste_id, contrato_id, cliente_id, percentual_aplicado,
      vlr_mensal_antes, vlr_mensal_depois, vlr_delta, snapshot_antes, data_proximo_reajuste_antes
    ) VALUES (
      v_reajuste_id, r.contrato_id, r.cliente_id, p_percentual,
      v_base, ROUND(v_base * (1 + p_percentual/100), 2), ROUND(v_base * p_percentual/100, 2),
      v_snapshot, r.data_proximo_reajuste
    );

    v_total_antes := v_total_antes + v_base;
    v_total_delta := v_total_delta + ROUND(v_base * p_percentual/100, 2);
  END LOOP;

  v_total_depois := v_total_antes + v_total_delta;
  SELECT count(*) INTO v_qtd FROM reajuste_contratos WHERE reajuste_id = v_reajuste_id;

  UPDATE reajustes SET qtd_contratos = v_qtd, vlr_mensal_total_antes = ROUND(v_total_antes,2),
    vlr_reajuste_total = ROUND(v_total_delta,2), vlr_mensal_total_depois = ROUND(v_total_depois,2)
  WHERE id = v_reajuste_id;

  RETURN jsonb_build_object('reajuste_id', v_reajuste_id, 'qtd_contratos', v_qtd,
    'vlr_mensal_total_antes', ROUND(v_total_antes,2), 'vlr_reajuste_total', ROUND(v_total_delta,2),
    'vlr_mensal_total_depois', ROUND(v_total_depois,2));
END;
$$;



CREATE OR REPLACE FUNCTION "public"."set_group_monitor"("p_conversation_id" "uuid", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_tenant    uuid;
  v_instance  uuid;
  v_group_jid text;
  v_is_group  boolean;
  v_role      text;
  v_is_sa     boolean;
BEGIN
  SELECT role, is_super_admin INTO v_role, v_is_sa
  FROM profiles WHERE user_id = auth.uid();
  IF COALESCE(v_is_sa, false) = false AND coalesce(v_role, '') NOT IN ('admin','head') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT tenant_id, instance_id, group_jid, is_group
    INTO v_tenant, v_instance, v_group_jid, v_is_group
  FROM whatsapp_conversations WHERE id = p_conversation_id;

  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Conversa nao encontrada'; END IF;
  IF v_is_group IS NOT TRUE THEN RAISE EXCEPTION 'Conversa nao e um grupo'; END IF;

  UPDATE whatsapp_groups
     SET monitor_user_id = p_user_id, updated_at = now()
   WHERE tenant_id = v_tenant AND instance_id = v_instance AND group_jid = v_group_jid;

  UPDATE whatsapp_conversations
     SET monitor_user_id = p_user_id, updated_at = now()
   WHERE tenant_id = v_tenant AND instance_id = v_instance
     AND group_jid = v_group_jid AND is_group = true;

  RETURN jsonb_build_object('success', true, 'monitor_user_id', p_user_id);
END;
$$;



CREATE OR REPLACE FUNCTION "public"."soft_delete_ticket"("p_ticket_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_role text;
BEGIN
  SELECT p.role INTO v_role
  FROM profiles p WHERE p.user_id = auth.uid();

  IF coalesce(v_role, '') NOT IN ('admin', 'head', 'super_admin') AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Apenas admin ou head podem excluir tickets.';
  END IF;

  UPDATE support_tickets
  SET deleted_at = now()
  WHERE id = p_ticket_id AND deleted_at IS NULL;
END;
$$;



CREATE OR REPLACE FUNCTION "public"."trg_protect_terminal_ticket"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_terminal boolean;
  v_role text;
BEGIN
  -- Se está sendo soft-deleted, permite (a RPC valida role)
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Se status_id antigo era terminal, bloqueia update (exceto admin/head)
  IF OLD.status_id IS NOT NULL THEN
    SELECT is_terminal INTO v_is_terminal
    FROM ticket_statuses WHERE id = OLD.status_id;

    IF v_is_terminal THEN
      SELECT p.role INTO v_role
      FROM profiles p WHERE p.user_id = auth.uid();

      IF coalesce(v_role, '') NOT IN ('admin', 'head', 'super_admin') AND NOT public.is_super_admin() THEN
        RAISE EXCEPTION 'Ticket finalizado não pode ser alterado. Solicite reabertura a um admin.';
      END IF;
    END IF;
  END IF;

  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;



