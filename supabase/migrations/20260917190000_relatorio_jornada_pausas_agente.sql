-- =====================================================================
-- Relatorio historico de pausas e jornada por agente
--
-- A tabela support_agent_presence_events ja registra tudo desde 26/03/2026;
-- faltava a camada de leitura. O que ela NAO registra e o que obriga esta
-- funcao a ter regra de truncamento (medido em producao em 17/09/2026, sobre
-- 13.968 eventos / 3.133 dias-agente):
--
--   * 658 dias-agente tem pausa e NENHUM shift_start. Causa: clicar "Iniciar
--     expediente" estando pausado cai no ramo ELSIF de agent_presence_set_active
--     e grava SO 'pause_end' -- o expediente do dia nasce sem hora de entrada.
--   * 690 dias tem entrada e nenhum encerramento (fechou o navegador).
--   * 157 pausas passam de 12h, a maior com 9,7 DIAS: o agente pausou, foi
--     embora, e o 'pause_end' so chegou quando ele voltou no dia seguinte.
--   * agent_presence_admin_set_status nao emite 'pause_end' ao religar um
--     agente pausado -- 9 pausas ficam penduradas nela.
--
-- Somar pause_end - pause_start cru entrega "media de 258 min em pausa" contra
-- mediana de 61 na Digi Office. Regra adotada (decisao do Alexandre, 17/09):
-- TRUNCAR NO ULTIMO EVENTO DO DIA e marcar a linha, nunca inventar horario.
--   - Pausa/expediente que atravessa a meia-noite para no ultimo evento
--     daquele dia.
--   - Pausa cujo proprio inicio e o ultimo evento do dia usa a PREVISAO que o
--     agente declarou (payload->>'minutes'), limitada ao fim do dia. E o unico
--     numero disponivel que nao e chute -- e entra no balde "estimado".
--   - Dia sem shift_start: entrada = 1o evento do dia (flag sem_entrada).
--   - Dia sem encerramento: saida = ultimo evento do dia (flag sem_saida).
-- Os minutos truncados saem separados em *_est_seg para o gestor saber quanto
-- do total nao e registro.
--
-- Excecao do DIA CORRENTE: pausa ou expediente sem evento posterior HOJE nao e
-- registro faltando, e coisa acontecendo agora -- conta ate now() e sai com
-- em_andamento=true, nunca como estimado nem como "sem saida". Sem isso a tela
-- de hoje marcaria de estimada toda pausa em curso (medido na Delvale: as 4
-- ultimas do periodo eram exatamente isso) e o gestor desconfiaria do relatorio
-- inteiro.
--
-- Jornada efetiva = soma dos intervalos em estado 'ativo', nao (saida-entrada).
-- Isso trata de graca os 550 dias com mais de um expediente: o intervalo entre
-- eles fica de fora, e nunca ha jornada negativa.
--
-- Conferido contra producao: Alberto Fernandes (Delvale) em 16/09/2026 sai com
-- 532 min ativo + 99 em pausa = 10h31, exatamente 07:32 -> 18:03.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_atendimento_jornada(
  p_tenant_id     uuid,
  p_date_from     timestamptz,
  p_date_to       timestamptz,
  p_department_id uuid DEFAULT NULL,
  p_agent_id      uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_super   boolean := COALESCE(public.is_super_admin(), false);
  v_gestor  boolean;
  v_tenant  uuid;
  v_agent   uuid;
  v_uid     uuid := auth.uid();
  v_to      timestamptz;
  v_dia_ini date;
  v_dia_fim date;
  v_hoje    date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_result  jsonb;
BEGIN
  -- is_super_admin() devolve NULL para quem nao tem linha em profiles; sem o
  -- COALESCE acima, "IF NOT v_super" nunca dispararia.
  IF p_tenant_id IS NOT NULL AND v_super THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  -- SECURITY DEFINER passa por cima da RLS da tabela, que libera o extrato da
  -- equipe so para admin/head e o proprio para os demais. Mesma regra aqui:
  -- operador que chamar a RPC na mao le so a propria jornada.
  v_gestor := v_super OR public.is_admin_or_head();
  IF v_gestor THEN
    v_agent := p_agent_id;
  ELSE
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    v_agent := v_uid;
  END IF;

  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RAISE EXCEPTION 'Informe o período (data inicial e final)';
  END IF;
  IF p_date_from > now() THEN
    RAISE EXCEPTION 'O período selecionado está no futuro e não tem registro de jornada';
  END IF;
  v_to := least(p_date_to, now());
  IF v_to <= p_date_from THEN
    RAISE EXCEPTION 'Período inválido: a data final deve ser maior que a inicial';
  END IF;
  IF v_to - p_date_from > interval '400 days' THEN
    RAISE EXCEPTION 'Período muito longo (máximo 400 dias)';
  END IF;

  v_dia_ini := (p_date_from AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dia_fim := (v_to        AT TIME ZONE 'America/Sao_Paulo')::date;

  WITH base AS (
    -- Janela folgada de 7 dias para cada lado: o lead() precisa do evento
    -- seguinte (que pode cair fora do periodo) e o estado herdado precisa do
    -- anterior. A tabela inteira tem ~14k linhas e o indice
    -- (tenant_id, user_id, created_at DESC) ja existe.
    SELECT e.user_id,
           e.event_type,
           e.created_at,
           e.pause_reason_id,
           CASE WHEN e.payload->>'minutes' ~ '^[0-9]+$'
                THEN (e.payload->>'minutes')::int END AS prev_min,
           (e.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS dia
    FROM support_agent_presence_events e
    WHERE e.tenant_id = v_tenant
      AND e.created_at >= p_date_from - interval '7 days'
      AND e.created_at <  v_to        + interval '7 days'
      AND (v_agent IS NULL OR e.user_id = v_agent)
      AND (p_department_id IS NULL OR EXISTS (
            SELECT 1 FROM support_department_members m
            WHERE m.tenant_id = v_tenant
              AND m.user_id = e.user_id
              AND m.department_id = p_department_id
              AND m.is_active))
  ),
  st AS (
    SELECT b.*,
           CASE b.event_type
             -- 'shift_end_keep_assignments' e 'shift_end_release_to_queue' sao
             -- marcadores gravados JUNTO com um 'shift_end' pela mesma funcao;
             -- mapeados para o mesmo estado, nao contam expediente a parte.
             WHEN 'shift_start'                THEN 'ativo'
             WHEN 'pause_end'                  THEN 'ativo'
             WHEN 'admin_set_active'           THEN 'ativo'
             WHEN 'pause_start'                THEN 'pausa'
             WHEN 'shift_end'                  THEN 'offline'
             WHEN 'admin_shift_end'            THEN 'offline'
             WHEN 'shift_end_keep_assignments' THEN 'offline'
             WHEN 'shift_end_release_to_queue' THEN 'offline'
             -- 'acceptance_timeout' e 'pause_extend' nao mudam de estado:
             -- herdam o anterior (o extend mantem a pausa inteira, sem cortar
             -- em duas).
             ELSE NULL
           END AS novo
    FROM base b
  ),
  g AS (
    SELECT st.*,
           count(novo) OVER (PARTITION BY user_id ORDER BY created_at
                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
    FROM st
  ),
  f AS (
    SELECT g.*,
           first_value(novo) OVER (PARTITION BY user_id, grp ORDER BY created_at) AS estado
    FROM g
  ),
  iv AS (
    SELECT f.user_id, f.dia, f.estado, f.created_at AS ini, f.pause_reason_id, f.prev_min,
           lead(f.created_at) OVER w AS fim,
           (lead(f.created_at) OVER w AT TIME ZONE 'America/Sao_Paulo')::date AS fim_dia
    FROM f
    WINDOW w AS (PARTITION BY f.user_id ORDER BY f.created_at)
  ),
  isl AS (
    -- Ilhas: junta intervalos consecutivos de mesmo estado no mesmo dia em UMA
    -- pausa / UM trecho de expediente. Particionado por dia de proposito, para
    -- nenhum trecho atravessar a virada.
    --
    -- As linhas 'offline' FICAM aqui e saem so no runs. Elas nao entram em
    -- nenhum total, mas precisam contar na numeracao: quem encerra as 17:48 e
    -- reabre as 20:00 tem dois trechos ativos no mesmo dia, e sem o offline no
    -- meio eles ficam adjacentes e a ilha os funde num trecho unico de
    -- 08:15 as 21:30 -- somando as 2h em que o agente estava fora. Medido no
    -- banco local em 17/09/2026: 12h15 de jornada onde o certo era 10h03.
    -- Em producao sao 550 dias-agente com mais de um expediente.
    SELECT iv.*,
           row_number() OVER (PARTITION BY user_id, dia ORDER BY ini)
         - row_number() OVER (PARTITION BY user_id, dia, estado ORDER BY ini) AS ilha
    FROM iv
    WHERE estado IS NOT NULL
  ),
  runs AS (
    SELECT user_id, dia, estado, ilha,
           min(ini) AS ini,
           max(ini) AS ancora,
           -- max() ignora NULL; o 'infinity' preserva "trecho sem proximo evento".
           nullif(max(coalesce(fim, 'infinity'::timestamptz)), 'infinity'::timestamptz) AS fim,
           max(fim_dia) AS fim_dia,
           (array_agg(pause_reason_id ORDER BY ini))[1] AS motivo_id,
           (array_agg(prev_min        ORDER BY ini))[1] AS prev_min
    FROM isl
    WHERE estado <> 'offline'
    GROUP BY 1,2,3,4
  ),
  calc AS (
    SELECT r.*,
           (r.fim IS NOT NULL AND r.fim_dia = r.dia) AS ok,
           -- Sem evento posterior E hoje = esta rolando agora, nao e furo.
           (r.fim IS NULL AND r.dia = v_hoje) AS em_andamento,
           CASE
             WHEN r.fim IS NOT NULL AND r.fim_dia = r.dia THEN r.fim
             WHEN r.fim IS NULL AND r.dia = v_hoje THEN now()
             WHEN r.estado = 'pausa' AND r.ancora = r.ini
               THEN least(r.ini + make_interval(mins => coalesce(r.prev_min, 0)),
                          ((r.dia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo'))
             ELSE r.ancora
           END AS fim_efetivo
    FROM runs r
  ),
  seg AS (
    SELECT c.*, extract(epoch FROM (c.fim_efetivo - c.ini))::bigint AS segundos
    FROM calc c
    WHERE c.dia BETWEEN v_dia_ini AND v_dia_fim
  ),
  flags AS (
    SELECT user_id, dia,
           bool_or(event_type = 'shift_start') AS tem_entrada,
           bool_or(event_type IN ('shift_end','admin_shift_end')) AS tem_saida
    FROM base
    WHERE dia BETWEEN v_dia_ini AND v_dia_fim
    GROUP BY 1,2
  ),
  dias AS (
    SELECT s.user_id, s.dia,
           min(s.ini)         AS entrada,
           max(s.fim_efetivo) AS saida,
           coalesce(sum(s.segundos) FILTER (WHERE s.estado = 'ativo'), 0) AS ativo_seg,
           coalesce(sum(s.segundos) FILTER (WHERE s.estado = 'pausa'), 0) AS pausa_seg,
           coalesce(sum(s.segundos) FILTER (WHERE s.estado = 'ativo' AND NOT s.ok AND NOT s.em_andamento), 0) AS ativo_est_seg,
           coalesce(sum(s.segundos) FILTER (WHERE s.estado = 'pausa' AND NOT s.ok AND NOT s.em_andamento), 0) AS pausa_est_seg,
           count(*) FILTER (WHERE s.estado = 'pausa') AS pausas,
           bool_or(s.em_andamento) AS em_andamento,
           coalesce(bool_or(fl.tem_entrada), false) AS tem_entrada,
           -- Expediente aberto agora nao e dia "sem saida": ele nao acabou.
           (coalesce(bool_or(fl.tem_saida), false) OR bool_or(s.em_andamento)) AS tem_saida
    FROM seg s
    LEFT JOIN flags fl ON fl.user_id = s.user_id AND fl.dia = s.dia
    GROUP BY 1,2
  ),
  nomes AS (
    SELECT d.user_id,
           coalesce(fu.nome, '(sem nome)') AS nome
    FROM (SELECT DISTINCT user_id FROM dias) d
    LEFT JOIN profiles     p  ON p.user_id = d.user_id
    LEFT JOIN funcionarios fu ON fu.id = p.funcionario_id
  )
  SELECT jsonb_build_object(
    'periodo', jsonb_build_object(
      'de',  v_dia_ini,
      'ate', v_dia_fim,
      'truncado_no_agora', (v_to < p_date_to)
    ),
    'totais', (
      SELECT jsonb_build_object(
        'agentes',          count(DISTINCT user_id),
        'dias',             count(*),
        'pausas',           coalesce(sum(pausas), 0),
        'ativo_seg',        coalesce(sum(ativo_seg), 0),
        'pausa_seg',        coalesce(sum(pausa_seg), 0),
        'bruto_seg',        coalesce(sum(ativo_seg + pausa_seg), 0),
        'ativo_est_seg',    coalesce(sum(ativo_est_seg), 0),
        'pausa_est_seg',    coalesce(sum(pausa_est_seg), 0),
        'dias_sem_entrada', count(*) FILTER (WHERE NOT tem_entrada),
        'dias_sem_saida',   count(*) FILTER (WHERE NOT tem_saida),
        'dias_incompletos', count(*) FILTER (WHERE NOT tem_entrada OR NOT tem_saida)
      ) FROM dias
    ),
    'agentes', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'nome')
      FROM (
        SELECT jsonb_build_object(
          'user_id',          d.user_id,
          'nome',             n.nome,
          'dias',             count(*),
          'pausas',           coalesce(sum(d.pausas), 0),
          'ativo_seg',        coalesce(sum(d.ativo_seg), 0),
          'pausa_seg',        coalesce(sum(d.pausa_seg), 0),
          'bruto_seg',        coalesce(sum(d.ativo_seg + d.pausa_seg), 0),
          'est_seg',          coalesce(sum(d.ativo_est_seg + d.pausa_est_seg), 0),
          'dias_incompletos', count(*) FILTER (WHERE NOT d.tem_entrada OR NOT d.tem_saida)
        ) AS x
        FROM dias d JOIN nomes n ON n.user_id = d.user_id
        GROUP BY d.user_id, n.nome
      ) q
    ), '[]'::jsonb),
    'dias', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'dia' DESC, x->>'nome')
      FROM (
        SELECT jsonb_build_object(
          'user_id',      d.user_id,
          'nome',         n.nome,
          'dia',          d.dia,
          'entrada',      d.entrada,
          'saida',        d.saida,
          'ativo_seg',    d.ativo_seg,
          'pausa_seg',    d.pausa_seg,
          'bruto_seg',    d.ativo_seg + d.pausa_seg,
          'pausas',       d.pausas,
          'sem_entrada',  NOT d.tem_entrada,
          'sem_saida',    NOT d.tem_saida,
          'em_andamento', coalesce(d.em_andamento, false)
        ) AS x
        FROM dias d JOIN nomes n ON n.user_id = d.user_id
      ) q
    ), '[]'::jsonb),
    'pausas', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'inicio' DESC)
      FROM (
        SELECT jsonb_build_object(
          'user_id',      s.user_id,
          'nome',         n.nome,
          'dia',          s.dia,
          'inicio',       s.ini,
          'fim',          s.fim_efetivo,
          'segundos',     s.segundos,
          'motivo',       coalesce(pr.name, 'Sem motivo'),
          'previsto_min', s.prev_min,
          'estimada',     (NOT s.ok AND NOT s.em_andamento),
          'em_andamento', s.em_andamento
        ) AS x
        FROM seg s
        JOIN nomes n ON n.user_id = s.user_id
        LEFT JOIN support_pause_reasons pr ON pr.id = s.motivo_id
        WHERE s.estado = 'pausa'
        ORDER BY s.ini DESC
        LIMIT 5000
      ) q
    ), '[]'::jsonb),
    'pausas_limitadas', (SELECT count(*) > 5000 FROM seg WHERE estado = 'pausa'),
    'motivos', coalesce((
      SELECT jsonb_agg(x ORDER BY (x->>'segundos')::bigint DESC)
      FROM (
        SELECT jsonb_build_object(
          'motivo',    coalesce(pr.name, 'Sem motivo'),
          'pausas',    count(*),
          'segundos',  coalesce(sum(s.segundos), 0),
          'media_seg', round(avg(s.segundos))
        ) AS x
        FROM seg s
        LEFT JOIN support_pause_reasons pr ON pr.id = s.motivo_id
        WHERE s.estado = 'pausa'
        GROUP BY coalesce(pr.name, 'Sem motivo')
      ) q
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.get_atendimento_jornada(uuid, timestamptz, timestamptz, uuid, uuid) IS
  'Historico de pausas e jornada por agente a partir de support_agent_presence_events. '
  'Jornada efetiva = soma dos intervalos em estado ativo. Pausa/expediente sem '
  'encerramento e truncado no ultimo evento do dia (pausa cujo inicio e o ultimo '
  'evento usa a previsao declarada) e marcado: os minutos truncados saem em '
  '*_est_seg e as linhas em sem_entrada / sem_saida / estimada. Nao inventa horario. '
  'Operador que nao e admin/head le apenas a propria jornada.';

REVOKE ALL ON FUNCTION public.get_atendimento_jornada(uuid, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_atendimento_jornada(uuid, timestamptz, timestamptz, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_atendimento_jornada(uuid, timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;
