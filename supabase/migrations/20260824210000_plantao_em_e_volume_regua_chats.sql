-- ============================================================================
-- plantao_em (quando o plantão aconteceu) + Volume na régua do Chats
--
-- [1] `plantao` diz SE houve plantão; `plantao_em` diz QUANDO. O mapa de calor
--     da aba Volume plotava por opened_at e, sob "Só plantão", pintava a hora
--     de ABERTURA: o caso 04094/26 da Digi Office aparecia numa sexta às 16h
--     quando o trabalho fora do expediente foi na quinta seguinte às 21h20.
--
-- [2] get_atendimento_volume tinha DUAS CTEs com predicados diferentes: `base`
--     (card Total) excluía atendimento sem mensagem do cliente e
--     autoatendimento da URA, `base_all` (Proativo vs Reativo, Canais) excluía
--     só a URA. A aba se contradizia sozinha — card 16, proativo+reativo 20.
--     E contra a aba Chats era 2.109 x 1.785 em julho.
--     Decisão do Alexandre em 24/08: igualar pela régua do Chats. As duas CTEs
--     viraram UMA. O "Total no Período" sobe de 6% (Feax) a 37% (Liberty).
--
-- Gerado a partir das definições vigentes em produção em 24/08/2026.
-- ============================================================================

ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS plantao_em timestamptz;

COMMENT ON COLUMN public.support_attendances.plantao_em IS
  'Primeiro instante de trabalho de agente fora do expediente (tolerancia 30min). NULL = nao houve. plantao = (plantao_em IS NOT NULL).';

-- ---- fn_atendimento_plantao_em ----
CREATE OR REPLACE FUNCTION "public"."fn_atendimento_plantao_em"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer DEFAULT 30) RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_min timestamptz;
  v_msg timestamptz;
BEGIN
  IF public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_assumed_at, p_tolerancia_min)
  THEN v_min := p_assumed_at; END IF;

  IF public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_first_human_at, p_tolerancia_min)
  THEN v_min := LEAST(COALESCE(v_min, p_first_human_at), p_first_human_at); END IF;

  IF p_conversation_id IS NOT NULL AND p_opened_at IS NOT NULL THEN
    SELECT min(m.timestamp) INTO v_msg
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.timestamp >= p_opened_at
      AND m.timestamp <= COALESCE(p_closed_at, now())
      AND m.sent_by_user_id IS NOT NULL
      AND public.fn_instante_fora_expediente(p_tenant_id, p_department_id, m.timestamp, p_tolerancia_min);

    IF v_msg IS NOT NULL THEN v_min := LEAST(COALESCE(v_min, v_msg), v_msg); END IF;
  END IF;

  RETURN v_min;
END;
$$;

REVOKE ALL ON FUNCTION "public"."fn_atendimento_plantao_em"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_atendimento_plantao_em"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_atendimento_plantao_em"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer) TO "service_role";

-- ---- fn_atendimento_teve_plantao ----
CREATE OR REPLACE FUNCTION "public"."fn_atendimento_teve_plantao"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer DEFAULT 30) RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT public.fn_atendimento_plantao_em(
           p_tenant_id, p_department_id, p_conversation_id,
           p_opened_at, p_closed_at, p_assumed_at, p_first_human_at,
           p_tolerancia_min) IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION "public"."fn_atendimento_teve_plantao"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fn_atendimento_teve_plantao"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."fn_atendimento_teve_plantao"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_conversation_id" "uuid", "p_opened_at" timestamp with time zone, "p_closed_at" timestamp with time zone, "p_assumed_at" timestamp with time zone, "p_first_human_at" timestamp with time zone, "p_tolerancia_min" integer) TO "service_role";

-- ---- trg_set_attendance_plantao ----
CREATE OR REPLACE FUNCTION "public"."trg_set_attendance_plantao"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  BEGIN
    NEW.plantao_em := public.fn_atendimento_plantao_em(
      NEW.tenant_id, NEW.department_id, NEW.conversation_id,
      NEW.opened_at, COALESCE(NEW.closed_at, now()),
      NEW.assumed_at, NEW.first_human_response_at
    );
    NEW.plantao := (NEW.plantao_em IS NOT NULL);
  EXCEPTION WHEN OTHERS THEN
    -- Fechar atendimento é caminho crítico: relatório nunca pode barrar o close.
    NEW.plantao := NULL;
    NEW.plantao_em := NULL;
  END;
  RETURN NEW;
END;
$$;

GRANT ALL ON FUNCTION "public"."trg_set_attendance_plantao"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_set_attendance_plantao"() TO "service_role";

-- ---- get_atendimento_volume ----
DO $mig$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='get_atendimento_volume'
  LOOP EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig; END LOOP;
END $mig$;

CREATE OR REPLACE FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_unidade_base_id" bigint DEFAULT NULL::bigint, "p_agent_id" "uuid" DEFAULT NULL::"uuid", "p_is_group" boolean DEFAULT NULL::boolean, "p_plantao" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  WITH firsts AS (
    -- Referência do novo vs recorrente: enxerga TODOS os atendimentos do
    -- contato e NÃO recebe o filtro de plantão (ver migration 20260824170000).
    SELECT contact_id, MIN(opened_at) AS first_at
    FROM support_attendances
    WHERE tenant_id = v_tenant AND contact_id IS NOT NULL
      AND (p_unidade_base_id IS NULL OR unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR unidade_base_id IS NULL OR unidade_base_id = ANY(v_unids))
      AND (p_is_group IS NULL OR COALESCE(is_group, false) = p_is_group)
    GROUP BY contact_id
  ),
  -- CTE única: era `base` + `base_all` com predicados diferentes, o que fazia
  -- o card e o Proativo/Reativo discordarem na mesma tela.
  base AS (
    SELECT a.opened_at, a.created_from, a.ai_tags, f.first_at,
           ((CASE WHEN p_plantao = 'plantao' THEN COALESCE(a.plantao_em, a.opened_at)
                  ELSE a.opened_at END) AT TIME ZONE 'America/Sao_Paulo') AS local_ts
    FROM support_attendances a
    LEFT JOIN firsts f ON f.contact_id = a.contact_id
    WHERE a.tenant_id = v_tenant
      AND a.opened_at >= p_date_from AND a.opened_at <= p_date_to
      AND (p_department_id IS NULL OR a.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR a.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR a.unidade_base_id IS NULL OR a.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR a.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(a.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(a.plantao, false))
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'novos',       (SELECT count(*) FROM base WHERE first_at IS NOT NULL AND opened_at = first_at),
    'recorrentes', (SELECT count(*) FROM base WHERE first_at IS NOT NULL AND opened_at > first_at),
    'proativo', (SELECT count(*) FROM base WHERE created_from IN ('agent','operator','billing_automation','ticket')),
    'reativo',  (SELECT count(*) FROM base WHERE created_from IN ('customer','out_of_hours')),
    'canais', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('canal', COALESCE(created_from,'(sem origem)'), 'qtd', c) ORDER BY c DESC)
      FROM (SELECT created_from, count(*) c FROM base GROUP BY created_from) x), '[]'::jsonb),
    'heatmap', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dow', dow, 'hora', hora, 'qtd', c))
      FROM (SELECT EXTRACT(DOW FROM local_ts)::int AS dow, EXTRACT(HOUR FROM local_ts)::int AS hora, count(*) c
            FROM base GROUP BY 1,2) h), '[]'::jsonb),
    'heatmap_eixo', CASE WHEN p_plantao = 'plantao' THEN 'plantao' ELSE 'abertura' END,
    'top_motivos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tag', tag, 'qtd', c) ORDER BY c DESC)
      FROM (SELECT unnest(ai_tags) AS tag, count(*) c FROM base WHERE ai_tags IS NOT NULL GROUP BY 1 ORDER BY c DESC LIMIT 15) t), '[]'::jsonb),
    'motivos_cobertura', (SELECT CASE WHEN count(*)>0
        THEN ROUND(100.0*count(*) FILTER (WHERE ai_tags IS NOT NULL AND array_length(ai_tags,1)>=1)/count(*),1) ELSE NULL END FROM base)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_atendimento_volume"("p_tenant_id" "uuid", "p_date_from" timestamp with time zone, "p_date_to" timestamp with time zone, "p_department_id" "uuid", "p_unidade_base_id" bigint, "p_agent_id" "uuid", "p_is_group" boolean, "p_plantao" "text") TO "service_role";

-- ---- get_atendimento_chats_lista ----
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
           sa.plantao_em,
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
               'plantao_em',      a.plantao_em,
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

-- Backfill: so as linhas ja marcadas como plantao. Mesma guarda do backfill
-- original — as linhas sem setor cuja conversa ainda tem setor ficam de fora
-- porque sync_attendance_department herdaria o setor e reescreveria o
-- historico em silencio.
WITH alvo AS (
  SELECT sa.id,
         public.fn_atendimento_plantao_em(sa.tenant_id, sa.department_id, sa.conversation_id,
           sa.opened_at, sa.closed_at, sa.assumed_at, sa.first_human_response_at) AS em
  FROM public.support_attendances sa
  LEFT JOIN public.whatsapp_conversations c ON c.id = sa.conversation_id
  WHERE sa.plantao IS TRUE AND sa.plantao_em IS NULL
    AND NOT (sa.department_id IS NULL AND c.department_id IS NOT NULL)
)
UPDATE public.support_attendances s
SET plantao_em = a.em
FROM alvo a
WHERE s.id = a.id AND a.em IS NOT NULL;
