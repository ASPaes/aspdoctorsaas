-- DEM-0340 · Drill-down dos cards de tempo da aba Velocidade / SLA.
--
-- O card mostra a mediana; esta função mostra os atendimentos que a formaram,
-- um por linha, do maior tempo para o menor.
--
-- Duas decisões que valem para as 4 métricas:
--
-- 1. O universo é o MESMO da `get_atendimento_velocidade` — mesma CTE `base`,
--    mesmos filtros, mesma exclusão de URA. Se divergir, o total da lista deixa
--    de fechar com o número do card e a tela passa a mentir.
--
-- 2. `kpi_cap_seconds(métrica)` corta os outliers do percentil, mas eles NÃO são
--    escondidos aqui: vêm marcados com `no_calculo = false`. São justamente os
--    piores casos, e é para caçá-los que a lista existe.
CREATE OR REPLACE FUNCTION public.get_atendimento_velocidade_lista(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_metrica         text    DEFAULT 'tme',
  p_department_id   uuid    DEFAULT NULL,
  p_unidade_base_id bigint  DEFAULT NULL,
  p_agent_id        uuid    DEFAULT NULL,
  p_is_group        boolean DEFAULT NULL,
  p_plantao         text    DEFAULT NULL,
  p_limit           integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_unids  bigint[];
  v_cap    int;
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_metrica IS NULL OR p_metrica NOT IN ('tme','frt','tma','tmr') THEN
    RAISE EXCEPTION 'p_metrica inválida: % (use tme, frt, tma ou tmr)', p_metrica;
  END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_cap   := public.kpi_cap_seconds(p_metrica);
  v_unids := public.user_effective_unidades();

  WITH base AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id,
           sa.department_id, sa.assigned_to,
           sa.opened_at, sa.closed_at, sa.assumed_at,
           COALESCE(sa.is_group, false) AS is_group,
           CASE p_metrica
             WHEN 'tme' THEN sa.wait_seconds
             WHEN 'frt' THEN sa.first_response_time_seconds
             WHEN 'tma' THEN sa.handle_seconds
             ELSE (COALESCE(sa.wait_seconds, 0) + COALESCE(sa.handle_seconds, 0))::int
           END AS seg
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status = 'closed' AND sa.closed_reason IS DISTINCT FROM 'ura_autoatendimento'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ),
  -- Só quem tem tempo medido. O resto (assumido no mesmo segundo, sem 1ª resposta)
  -- não sai da conta: vira o `total_sem_valor`, que a tela explica.
  com_valor AS (
    SELECT b.*,
           (b.seg <= v_cap) AS no_calculo,
           sd.name AS departamento,
           COALESCE(c.nome_fantasia, c.razao_social) AS cliente_nome,
           f.nome AS agente
    FROM base b
    LEFT JOIN support_departments sd ON sd.id = b.department_id
    LEFT JOIN clientes c            ON c.id  = b.cliente_id
    LEFT JOIN profiles p            ON p.user_id = b.assigned_to
    LEFT JOIN funcionarios f        ON f.id  = p.funcionario_id
    WHERE b.seg > 0
  )
  SELECT jsonb_build_object(
    'metrica',          p_metrica,
    'cap_seconds',      v_cap,
    'total_base',       (SELECT count(*) FROM base),
    'total_lista',      (SELECT count(*) FROM com_valor),
    'total_no_calculo', (SELECT count(*) FROM com_valor WHERE no_calculo),
    'total_fora_cap',   (SELECT count(*) FROM com_valor WHERE NOT no_calculo),
    'total_sem_valor',  (SELECT count(*) FROM base) - (SELECT count(*) FROM com_valor),
    'p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY seg))::int FROM com_valor WHERE no_calculo),
    'p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY seg))::int FROM com_valor WHERE no_calculo),
    'truncado',         (SELECT count(*) FROM com_valor) > p_limit,
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'attendance_id',   a.id,
               'attendance_code', a.attendance_code,
               'conversation_id', a.conversation_id,
               'opened_at',       a.opened_at,
               'closed_at',       a.closed_at,
               'contato',         COALESCE(a.contact_name, a.contact_phone, 'Sem nome'),
               'cliente_id',      a.cliente_id,
               'cliente_nome',    a.cliente_nome,
               'departamento',    a.departamento,
               'agente',          a.agente,
               'is_group',        a.is_group,
               'seg',             a.seg,
               'no_calculo',      a.no_calculo
             ) ORDER BY a.seg DESC, a.opened_at DESC)
      FROM (SELECT * FROM com_valor ORDER BY seg DESC, opened_at DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_atendimento_velocidade_lista(
  uuid, timestamptz, timestamptz, text, uuid, bigint, uuid, boolean, text, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_atendimento_velocidade_lista(
  uuid, timestamptz, timestamptz, text, uuid, bigint, uuid, boolean, text, integer
) TO authenticated, service_role;
