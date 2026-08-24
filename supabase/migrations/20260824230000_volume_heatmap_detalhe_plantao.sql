-- ============================================================================
-- Mapa de calor: cada célula passa a dizer QUE HORAS e de QUE SETOR
--
-- A célula é por HORA, mas a tolerância do plantão é de 30 min: um plantão às
-- 18:32 cai no balde "18" e o mapa parece dizer "trabalharam às 18h", que é dia
-- de trabalho normal. Foi a dúvida do Alexandre em 24/08 olhando "seg e ter às
-- 18" — eram 18:32 e 18:36, do setor Onboarding, que fecha 18:00.
--
-- Some-se a isso que CADA SETOR tem janela própria (Onboarding fecha 17:00 na
-- sexta, Suporte trabalha sábado até 22:00) e o mapa nunca mostrou o setor.
--
-- `detalhes` traz por célula até 12 entradas com hora:minuto, setor e o horário
-- de fechamento daquele setor naquele dia. Só no modo plantão — e a busca da
-- janela fica DENTRO de um CASE, cuja subconsulta só é avaliada quando o ramo é
-- tomado, para não pagar a função por linha no uso normal do dash.
--
-- Gerado a partir da definição vigente em produção em 24/08/2026.
-- ============================================================================

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
    -- contato e NÃO recebe o filtro de plantão.
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
    SELECT a.opened_at, a.created_from, a.ai_tags, f.first_at, a.department_id,
           (CASE WHEN p_plantao = 'plantao' THEN COALESCE(a.plantao_em, a.opened_at)
                 ELSE a.opened_at END) AS eixo_ts,
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
  ),
  heat_src AS (
    SELECT EXTRACT(DOW  FROM b.local_ts)::int AS dow,
           EXTRACT(HOUR FROM b.local_ts)::int AS hora,
           b.local_ts,
           to_char(b.local_ts, 'HH24:MI') AS hhmm,
           CASE WHEN p_plantao = 'plantao'
                THEN COALESCE((SELECT sd.name FROM support_departments sd WHERE sd.id = b.department_id), 'Sem setor')
           END AS setor,
           CASE WHEN p_plantao = 'plantao'
                THEN (SELECT to_char(j.fecha, 'HH24:MI')
                        FROM public.fn_expediente_janela_do_dia(v_tenant, b.department_id, b.eixo_ts) j)
           END AS fecha,
           row_number() OVER (
             PARTITION BY EXTRACT(DOW FROM b.local_ts)::int, EXTRACT(HOUR FROM b.local_ts)::int
             ORDER BY b.local_ts
           ) AS rn
    FROM base b
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
      SELECT jsonb_agg(jsonb_build_object(
               'dow', h.dow, 'hora', h.hora, 'qtd', h.c,
               'detalhes', h.det))
      FROM (
        SELECT dow, hora, count(*) AS c,
               CASE WHEN p_plantao = 'plantao' THEN
                 jsonb_agg(jsonb_build_object('hora', hhmm, 'setor', setor, 'fecha', fecha)
                           ORDER BY local_ts) FILTER (WHERE rn <= 12)
               END AS det
        FROM heat_src GROUP BY dow, hora
      ) h), '[]'::jsonb),
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
