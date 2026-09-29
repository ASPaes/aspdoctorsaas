-- DEM-0460 — TME e 1ª Resposta só contam tempo dentro do expediente
--
-- Até aqui a aba Velocidade (Dashboard de Atendimento e Meu Painel) lia
-- `support_attendances.wait_seconds` e `first_response_time_seconds`, gravados no
-- relógio de parede. Cliente que escreve às 06:59 e é atendido às 09:00, com o
-- Suporte abrindo às 09:00, entrava com 2h01 de espera. No print do chamado,
-- metade do topo da lista do TME era madrugada.
--
-- A partir daqui TME, 1ª Resposta e a parcela de espera do TMR são a soma da
-- interseção de [abertura, abertura + tempo] com as janelas de expediente do
-- SETOR do atendimento — a mesma régua da latência (DEM-0462), via
-- `fn_expediente_slots`. Atendimento que espera inteiro fora do expediente soma 0
-- e vai para o "sem valor" da lista, igual ao assumido na hora.
--
-- O que NÃO muda:
--   * As colunas gravadas. Nada é reescrito em `support_attendances` (28 gatilhos
--     na tabela; backfill ali é arriscado). O útil é calculado na leitura, então
--     vale também para o histórico.
--   * Os dois cards de SLA. "% dentro do SLA" segue no corrido e "% SLA (horário
--     útil)" segue em `first_response_business_seconds`, que já era útil.
--   * TMA (tempo nas mãos do agente).
--   * `get_atendimento_agentes` (coluna 1ª resposta por agente) — fica para um
--     segundo passo; é a função que mais colidiu entre sessões (DEM-0462/0464/0485).
--
-- Consequência conhecida, a mesma da DEM-0462: com o filtro "Plantão", o TME e a
-- 1ª Resposta tendem a "—", porque plantão é justamente atender fora da grade.
--
-- Corpos copiados de produção em 29/09/2026 (dump `--linked`). Quem mexer de novo
-- nessas funções: copie o corpo de produção na hora, nunca do repo.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Helper: tempo útil de espera e de 1ª resposta, em lote.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_atendimento_tempos_uteis(p_tenant_id uuid, p_ids uuid[])
 RETURNS TABLE(attendance_id uuid, wait_util integer, frt_util integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_from timestamptz;
  v_to   timestamptz;
BEGIN
  SELECT min(sa.opened_at),
         max(sa.opened_at + make_interval(secs => GREATEST(COALESCE(sa.wait_seconds, 0),
                                                           COALESCE(sa.first_response_time_seconds, 0))))
    INTO v_from, v_to
  FROM support_attendances sa
  WHERE sa.tenant_id = p_tenant_id AND sa.id = ANY(p_ids);

  IF v_from IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH jan AS (
    SELECT j.dep_key, j.ini, j.fim
    FROM public.fn_expediente_slots(p_tenant_id, v_from, v_to) j
  ),
  att AS (
    SELECT sa.id, sa.opened_at, sa.wait_seconds, sa.first_response_time_seconds,
           -- Setor apagado ou ausente cai na grade do tenant, como em `segundos_uteis`.
           COALESCE(sd.id, '00000000-0000-0000-0000-000000000000'::uuid) AS dep_key
    FROM support_attendances sa
    LEFT JOIN support_departments sd ON sd.id = sa.department_id AND sd.tenant_id = p_tenant_id
    WHERE sa.tenant_id = p_tenant_id AND sa.id = ANY(p_ids)
  ),
  trecho AS (
    SELECT a.id, 'tme'::text AS k, a.dep_key, a.opened_at AS ini,
           a.opened_at + make_interval(secs => a.wait_seconds) AS fim
    FROM att a WHERE a.wait_seconds > 0
    UNION ALL
    SELECT a.id, 'frt'::text, a.dep_key, a.opened_at,
           a.opened_at + make_interval(secs => a.first_response_time_seconds)
    FROM att a WHERE a.first_response_time_seconds > 0
  ),
  soma AS (
    SELECT t.id, t.k,
           -- LEAST/GREATEST ignoram NULL: sem o CASE, trecho sem janela nenhuma
           -- voltaria com o tempo corrido inteiro (armadilha da DEM-0462).
           ROUND(COALESCE(SUM(CASE WHEN w.ini IS NULL THEN 0
                                   ELSE GREATEST(0, EXTRACT(EPOCH FROM (LEAST(t.fim, w.fim)
                                                                     - GREATEST(t.ini, w.ini)))) END), 0))::int AS util
    FROM trecho t
    LEFT JOIN jan w ON w.dep_key = t.dep_key AND w.fim > t.ini AND w.ini < t.fim
    GROUP BY t.id, t.k
  )
  SELECT a.id,
         -- Sem tempo registrado (0/NULL) continua como estava: vira "sem valor".
         CASE WHEN COALESCE(a.wait_seconds, 0) > 0
              THEN max(s.util) FILTER (WHERE s.k = 'tme') ELSE a.wait_seconds END,
         CASE WHEN COALESCE(a.first_response_time_seconds, 0) > 0
              THEN max(s.util) FILTER (WHERE s.k = 'frt') ELSE a.first_response_time_seconds END
  FROM att a
  LEFT JOIN soma s ON s.id = a.id
  GROUP BY a.id, a.wait_seconds, a.first_response_time_seconds;
END;
$function$;

-- Só as RPCs (SECURITY DEFINER, dono postgres) chamam. `FROM PUBLIC` sozinho não
-- tira o acesso que o Supabase dá por padrão a anon/authenticated.
REVOKE ALL ON FUNCTION public.fn_atendimento_tempos_uteis(uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_atendimento_tempos_uteis(uuid, uuid[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_atendimento_tempos_uteis(uuid, uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Cards da aba Velocidade.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_atendimento_velocidade(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_sla_frt_seconds integer DEFAULT 900, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_unids  bigint[];
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  WITH base0 AS (
    SELECT sa.id, sa.first_response_time_seconds, sa.handle_seconds,
           sa.first_response_business_seconds,
           sa.opened_at, sa.closed_at, sa.department_id, sa.assumed_at,
           sa.ticket_id, sa.created_from,
           COALESCE(sa.msg_agent_count, 0) AS msg_agent_count,
           COALESCE(sa.plantao, false) AS plantao
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
  -- DEM-0460: TME, 1ª resposta e a espera do TMR em tempo útil do setor.
  util AS (
    SELECT * FROM public.fn_atendimento_tempos_uteis(v_tenant, ARRAY(SELECT id FROM base0))
  ),
  base AS (
    SELECT b.*,
           u.wait_util AS tme_seg,
           u.frt_util  AS frt_seg,
           (COALESCE(u.wait_util,0) + COALESCE(b.handle_seconds,0))::int AS resol_seconds
    FROM base0 b
    LEFT JOIN util u ON u.attendance_id = b.id
  ),
  vacuo AS (
    SELECT * FROM base
    WHERE assumed_at IS NULL
      AND ticket_id IS NULL
      AND created_from IS DISTINCT FROM 'ticket'
      AND msg_agent_count = 0
  )
  SELECT jsonb_build_object(
    'total_encerrados', (SELECT count(*) FROM base),
    'tme_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY tme_seg))::int FROM base WHERE tme_seg > 0 AND tme_seg <= kpi_cap_seconds('tme')),
    'tme_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY tme_seg))::int FROM base WHERE tme_seg > 0 AND tme_seg <= kpi_cap_seconds('tme')),
    'frt_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY frt_seg))::int FROM base WHERE frt_seg > 0 AND frt_seg <= kpi_cap_seconds('frt')),
    'frt_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY frt_seg))::int FROM base WHERE frt_seg > 0 AND frt_seg <= kpi_cap_seconds('frt')),
    'tma_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY handle_seconds))::int FROM base WHERE handle_seconds > 0 AND handle_seconds <= kpi_cap_seconds('tma')),
    'tma_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY handle_seconds))::int FROM base WHERE handle_seconds > 0 AND handle_seconds <= kpi_cap_seconds('tma')),
    'tmr_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY resol_seconds))::int FROM base WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')),
    'tmr_p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY resol_seconds))::int FROM base WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')),
    'sla_frt_seconds', p_sla_frt_seconds,
    'sla_total',  (SELECT count(*) FROM base WHERE first_response_time_seconds > 0),
    'sla_dentro', (SELECT count(*) FROM base WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds),
    'sla_pct', (SELECT CASE WHEN count(*) FILTER (WHERE first_response_time_seconds > 0) > 0
                  THEN ROUND(100.0 * count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds)
                             / count(*) FILTER (WHERE first_response_time_seconds > 0), 1)
                  ELSE NULL END FROM base),
    'sla_util_total',  (SELECT count(*) FROM base WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL),
    'sla_util_dentro', (SELECT count(*) FROM base WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL AND first_response_business_seconds <= p_sla_frt_seconds),
    'sla_util_pct', (SELECT CASE WHEN count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL) > 0
                  THEN ROUND(100.0 * count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL AND first_response_business_seconds <= p_sla_frt_seconds)
                             / count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_business_seconds IS NOT NULL), 1)
                  ELSE NULL END FROM base),
    'fora_horario', (SELECT count(*) FROM base WHERE plantao),
    'nao_atendido', (SELECT count(*) FROM vacuo),
    'nao_atendido_pct', (SELECT CASE WHEN (SELECT count(*) FROM base) > 0
                  THEN ROUND(100.0 * (SELECT count(*) FROM vacuo) / (SELECT count(*) FROM base), 1) ELSE NULL END),
    'por_departamento', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
                'department_id', d.department_id, 'nome', d.nome,
                'total', d.total, 'dentro', d.dentro,
                'alvo_seconds', d.alvo_seconds,
                'pct', CASE WHEN d.total > 0 THEN ROUND(100.0 * d.dentro / d.total, 1) ELSE NULL END)
              ORDER BY d.total DESC)
      FROM (
        SELECT b.department_id, sd.name AS nome,
               COALESCE(sd.sla_frt_seconds, p_sla_frt_seconds) AS alvo_seconds,
               count(*) FILTER (WHERE b.first_response_time_seconds > 0) AS total,
               count(*) FILTER (WHERE b.first_response_time_seconds > 0
                                  AND b.first_response_time_seconds <= COALESCE(sd.sla_frt_seconds, p_sla_frt_seconds)) AS dentro
        FROM base b LEFT JOIN support_departments sd ON sd.id = b.department_id
        GROUP BY b.department_id, sd.name, COALESCE(sd.sla_frt_seconds, p_sla_frt_seconds)
      ) d
      WHERE d.total > 0
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Lista do diálogo "TME / 1ª Resposta / TMA / TMR por atendimento".
--    `seg` passa a ser útil; `seg_corrido` vai junto para a tela explicar a diferença.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_atendimento_velocidade_lista(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_metrica text DEFAULT 'tme'::text, p_department_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text, p_limit integer DEFAULT 500)
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

  WITH base0 AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id,
           sa.department_id, sa.assigned_to,
           sa.opened_at, sa.closed_at, sa.assumed_at,
           sa.wait_seconds, sa.first_response_time_seconds, sa.handle_seconds,
           COALESCE(sa.is_group, false) AS is_group
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
  -- DEM-0460: TMA não depende de expediente; não gasta o cálculo à toa.
  util AS (
    SELECT * FROM public.fn_atendimento_tempos_uteis(
      v_tenant,
      CASE WHEN p_metrica = 'tma' THEN '{}'::uuid[] ELSE ARRAY(SELECT id FROM base0) END)
  ),
  base AS (
    SELECT b.*,
           CASE p_metrica
             WHEN 'tme' THEN u.wait_util
             WHEN 'frt' THEN u.frt_util
             WHEN 'tma' THEN b.handle_seconds
             ELSE (COALESCE(u.wait_util, 0) + COALESCE(b.handle_seconds, 0))::int
           END AS seg,
           CASE p_metrica
             WHEN 'tme' THEN b.wait_seconds
             WHEN 'frt' THEN b.first_response_time_seconds
             WHEN 'tma' THEN b.handle_seconds
             ELSE (COALESCE(b.wait_seconds, 0) + COALESCE(b.handle_seconds, 0))::int
           END AS seg_corrido
    FROM base0 b
    LEFT JOIN util u ON u.attendance_id = b.id
  ),
  -- Só quem tem tempo medido. O resto (assumido no mesmo segundo, sem 1ª resposta,
  -- espera inteira fora do expediente) não sai da conta: vira o `total_sem_valor`.
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
    'total_fora_expediente', (SELECT count(*) FROM base WHERE COALESCE(seg, 0) = 0 AND seg_corrido > 0),
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
               'seg_corrido',     a.seg_corrido,
               'no_calculo',      a.no_calculo
             ) ORDER BY a.seg DESC, a.opened_at DESC)
      FROM (SELECT * FROM com_valor ORDER BY seg DESC, opened_at DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Gráfico da aba Velocidade (p50 por dia/semana).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_atendimento_velocidade_timeline(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_bucket text DEFAULT 'day'::text, p_department_id uuid DEFAULT NULL::uuid, p_sla_frt_seconds integer DEFAULT 900, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_plantao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_trunc text;
  v_result jsonb;
  v_bh jsonb;
  v_por_dia boolean;
  dow_map text[] := ARRAY['sun','mon','tue','wed','thu','fri','sat'];
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();

  v_trunc := CASE WHEN p_bucket = 'week' THEN 'week' ELSE 'day' END;
  -- Semana engloba dia aberto e fechado; a marca só faz sentido no bucket diário.
  v_por_dia := (v_trunc = 'day');

  -- Horário vigente: o do setor filtrado, se ele tiver o próprio; senão o da
  -- empresa. NULL = ninguém configurou expediente, então nenhum dia é "fechado".
  SELECT business_hours INTO v_bh
  FROM support_departments
  WHERE id = p_department_id AND tenant_id = v_tenant AND business_hours_enabled = true;

  IF v_bh IS NULL THEN
    SELECT business_hours INTO v_bh
    FROM configuracoes
    WHERE tenant_id = v_tenant AND business_hours_enabled = true;
  END IF;

  WITH base0 AS (
    SELECT
      sa.id,
      date_trunc(v_trunc, (sa.opened_at AT TIME ZONE 'America/Sao_Paulo'))::date AS bucket,
      sa.first_response_time_seconds, sa.handle_seconds
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status = 'closed'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ),
  -- DEM-0460: TME, 1ª resposta e a espera do TMR em tempo útil do setor.
  -- O SLA do gráfico continua no corrido, igual ao card "% dentro do SLA".
  util AS (
    SELECT * FROM public.fn_atendimento_tempos_uteis(v_tenant, ARRAY(SELECT id FROM base0))
  ),
  base AS (
    SELECT b.bucket, b.first_response_time_seconds,
           u.wait_util AS tme_seg,
           u.frt_util  AS frt_seg,
           (COALESCE(u.wait_util,0) + COALESCE(b.handle_seconds,0))::int AS resol_seconds
    FROM base0 b
    LEFT JOIN util u ON u.attendance_id = b.id
  )
  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'bucket', to_char(g.bucket,'YYYY-MM-DD'),
             'volume', g.volume,
             'sla_total', g.sla_total,
             'sla_dentro', g.sla_dentro,
             'sla_pct', g.sla_pct,
             'tme_p50', g.tme_p50,
             'frt_p50', g.frt_p50,
             'tmr_p50', g.tmr_p50,
             'dia_fechado', COALESCE(f.fechado, false),
             'fechado_motivo', f.motivo
           ) ORDER BY g.bucket
         ), '[]'::jsonb)
  INTO v_result
  FROM (
    SELECT
      bucket,
      count(*) AS volume,
      count(*) FILTER (WHERE first_response_time_seconds > 0) AS sla_total,
      count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds) AS sla_dentro,
      CASE WHEN count(*) FILTER (WHERE first_response_time_seconds > 0) > 0
        THEN ROUND(100.0 * count(*) FILTER (WHERE first_response_time_seconds > 0 AND first_response_time_seconds <= p_sla_frt_seconds)
                   / count(*) FILTER (WHERE first_response_time_seconds > 0), 1)
        ELSE NULL END AS sla_pct,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY tme_seg) FILTER (WHERE tme_seg > 0 AND tme_seg <= kpi_cap_seconds('tme')))::int AS tme_p50,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY frt_seg) FILTER (WHERE frt_seg > 0 AND frt_seg <= kpi_cap_seconds('frt')))::int AS frt_p50,
      ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY resol_seconds) FILTER (WHERE resol_seconds BETWEEN 1 AND kpi_cap_seconds('tmr')))::int AS tmr_p50
    FROM base
    GROUP BY bucket
  ) g
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(exc.id IS NOT NULL, false)
        OR (v_bh IS NOT NULL
            AND NOT COALESCE((v_bh -> dow_map[EXTRACT(DOW FROM g.bucket)::int + 1] ->> 'active')::boolean, false))
        AS fechado,
      CASE
        WHEN exc.id IS NOT NULL THEN COALESCE(NULLIF(btrim(exc.name), ''), 'Feriado')
        WHEN v_bh IS NOT NULL
         AND NOT COALESCE((v_bh -> dow_map[EXTRACT(DOW FROM g.bucket)::int + 1] ->> 'active')::boolean, false)
         THEN 'Fora do expediente'
        ELSE NULL
      END AS motivo
    FROM (SELECT 1) _
    LEFT JOIN LATERAL (
      SELECT e.id, e.name
      FROM business_hours_exceptions e
      WHERE e.tenant_id = v_tenant
        AND e.date = g.bucket
        AND e.is_closed = true
        AND (e.department_id = p_department_id OR e.department_id IS NULL)
      -- Exceção do setor vence a global quando as duas existem.
      ORDER BY (e.department_id IS NULL)
      LIMIT 1
    ) exc ON true
    WHERE v_por_dia
  ) f ON true;

  RETURN v_result;
END;
$function$;

COMMIT;
