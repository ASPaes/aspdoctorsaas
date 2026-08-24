-- ============================================================================
-- get_atendimento_chats_lista — quais atendimentos formam o número do card
--
-- O card "Total de Atendimentos" da aba Chats abre a lista dos atendimentos que
-- o compõem, com link para o histórico de cada chat.
--
-- ⚠️ O WHERE aqui é CÓPIA do WHERE da CTE `at` de get_atendimento_chats, e
-- precisa continuar sendo. Duas RPCs com o mesmo filtro escrito em lugares
-- separados divergem com o tempo — foi assim que os cards da tela de
-- Atendimentos passaram a ignorar a busca. A guarda é
-- scripts/sql-tests/43_chats_lista_bate_com_total.sql, que compara o `total`
-- das duas sob 6 combinações de filtro. Mexeu numa, rode o teste.
--
-- `total` é a contagem SEM limite (tem que bater com o card). `itens` traz no
-- máximo p_limit linhas, das mais recentes; `truncado` avisa a tela.
--
-- Gerado a partir da definição vigente em produção em 24/08/2026.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_atendimento_chats_lista(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, bigint[], bigint[], bigint[],
  bigint[], bigint[], bigint[], text[], boolean, boolean, text[], text[], text, integer);

CREATE OR REPLACE FUNCTION "public"."get_atendimento_chats_lista"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_segmento_ids" bigint[] DEFAULT NULL::bigint[], "p_area_ids" bigint[] DEFAULT NULL::bigint[], "p_estado_ids" bigint[] DEFAULT NULL::bigint[], "p_cidade_ids" bigint[] DEFAULT NULL::bigint[], "p_fornecedor_ids" bigint[] DEFAULT NULL::bigint[], "p_produto_ids" bigint[] DEFAULT NULL::bigint[], "p_closed_reasons" "text"[] DEFAULT NULL::"text"[], "p_has_ticket" boolean DEFAULT NULL::boolean, "p_is_group" boolean DEFAULT NULL::boolean, "p_sentiments" "text"[] DEFAULT NULL::"text"[], "p_resolucoes" "text"[] DEFAULT NULL::"text"[], "p_plantao" "text" DEFAULT NULL::"text", "p_limit" integer DEFAULT 200) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
  v_has_cli boolean;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  v_has_cli := COALESCE(array_length(p_segmento_ids,1),0) > 0
            OR COALESCE(array_length(p_area_ids,1),0) > 0
            OR COALESCE(array_length(p_estado_ids,1),0) > 0
            OR COALESCE(array_length(p_cidade_ids,1),0) > 0
            OR COALESCE(array_length(p_fornecedor_ids,1),0) > 0
            OR COALESCE(array_length(p_produto_ids,1),0) > 0;

  WITH cli_ok AS (
    SELECT c.id
    FROM clientes c
    WHERE c.tenant_id = v_tenant
      AND (COALESCE(array_length(p_segmento_ids,1),0)=0 OR c.segmento_id = ANY(p_segmento_ids))
      AND (COALESCE(array_length(p_area_ids,1),0)=0 OR c.area_atuacao_id = ANY(p_area_ids))
      AND (COALESCE(array_length(p_estado_ids,1),0)=0 OR c.estado_id = ANY(p_estado_ids))
      AND (COALESCE(array_length(p_cidade_ids,1),0)=0 OR c.cidade_id = ANY(p_cidade_ids))
      AND (COALESCE(array_length(p_fornecedor_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.fornecedor_id = ANY(p_fornecedor_ids)))
      AND (COALESCE(array_length(p_produto_ids,1),0)=0 OR EXISTS (
            SELECT 1 FROM cliente_produtos cp WHERE cp.cliente_id=c.id AND cp.ativo=true AND cp.produto_id = ANY(p_produto_ids)))
  ),
  -- CÓPIA do WHERE da CTE `at` de get_atendimento_chats. Ver aviso no topo.
  at AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id, sa.department_id,
           sa.assigned_to, sa.opened_at, sa.closed_at, sa.closed_reason,
           sa.status, sa.last_sentiment, sa.resolucao, sa.csat_score,
           COALESCE(sa.plantao, false) AS plantao,
           COALESCE(sa.is_group, false) AS is_group
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (NOT v_has_cli OR sa.cliente_id IN (SELECT id FROM cli_ok))
      AND (p_closed_reasons IS NULL OR sa.closed_reason = ANY(p_closed_reasons))
      AND (p_has_ticket IS NULL OR (p_has_ticket AND sa.ticket_id IS NOT NULL) OR (NOT p_has_ticket AND sa.ticket_id IS NULL))
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_sentiments IS NULL OR sa.last_sentiment = ANY(p_sentiments))
      AND (p_resolucoes IS NULL OR COALESCE(sa.resolucao, '(sem)') = ANY(p_resolucoes))
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  )
  SELECT jsonb_build_object(
    'total',    (SELECT count(*) FROM at),
    'truncado', (SELECT count(*) FROM at) > p_limit,
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'attendance_id',   a.id,
               'attendance_code', a.attendance_code,
               'conversation_id', a.conversation_id,
               'contato',         COALESCE(NULLIF(a.contact_name,''), a.contact_phone, 'Sem nome'),
               'telefone',        a.contact_phone,
               'cliente_id',      a.cliente_id,
               'cliente_nome',    CASE WHEN a.cliente_id IS NULL THEN NULL
                                       ELSE COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') END,
               'agente',          f.nome,
               'departamento',    sd.name,
               'opened_at',       a.opened_at,
               'closed_at',       a.closed_at,
               'closed_reason',   a.closed_reason,
               'status',          a.status,
               'sentimento',      a.last_sentiment,
               'resolucao',       a.resolucao,
               'csat_score',      a.csat_score,
               'plantao',         a.plantao,
               'is_group',        a.is_group,
               'duracao_seg',     GREATEST(EXTRACT(EPOCH FROM (COALESCE(a.closed_at, now()) - a.opened_at))::int, 0)
             ) ORDER BY a.opened_at DESC)
      FROM (SELECT * FROM at ORDER BY opened_at DESC LIMIT p_limit) a
      LEFT JOIN clientes c             ON c.id  = a.cliente_id
      LEFT JOIN support_departments sd ON sd.id = a.department_id
      LEFT JOIN profiles pr            ON pr.user_id = a.assigned_to AND pr.tenant_id = v_tenant
      LEFT JOIN funcionarios f         ON f.id = pr.funcionario_id AND f.tenant_id = v_tenant
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_chats_lista"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_closed_reasons" "text"[], "p_has_ticket" boolean, "p_is_group" boolean, "p_sentiments" "text"[], "p_resolucoes" "text"[], "p_plantao" "text", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_chats_lista"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_closed_reasons" "text"[], "p_has_ticket" boolean, "p_is_group" boolean, "p_sentiments" "text"[], "p_resolucoes" "text"[], "p_plantao" "text", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_chats_lista"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_segmento_ids" bigint[], "p_area_ids" bigint[], "p_estado_ids" bigint[], "p_cidade_ids" bigint[], "p_fornecedor_ids" bigint[], "p_produto_ids" bigint[], "p_closed_reasons" "text"[], "p_has_ticket" boolean, "p_is_group" boolean, "p_sentiments" "text"[], "p_resolucoes" "text"[], "p_plantao" "text", "p_limit" integer) TO "service_role";
