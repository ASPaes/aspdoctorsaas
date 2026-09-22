-- Grupo sem responder: o relogio passa a ser "sem movimento no grupo"
--
-- Ate aqui a regua de grupo so corria quando a bola estava com o GRUPO: a fila
-- filtrava awaiting_agent_since IS NULL para todo mundo. Em 1:1 isso esta certo
-- (quem cuida da bola com o agente e a regua "Agente sem responder", via
-- fn_close_attendances_no_agent_response) -- mas aquela funcao tem
-- sa.is_group = false cravado. Resultado medido em producao em 22/09/2026, no
-- tenant Athuz: dos 20 atendimentos de grupo em andamento, 9 estavam com a
-- ultima mensagem sendo do cliente e portanto fora das DUAS reguas. Nenhum deles
-- encerrava nunca, nem por fim de expediente. O caso que levantou isso foi o
-- 02740/26 (grupo BDEBOLO CAFETERIA LTDA - PDV LEGAL), aberto as 10:30, cliente
-- falou 10:58, configuracao de 10 minutos, ainda aberto horas depois.
--
-- Em grupo nao faz sentido separar "bola do cliente" de "bola do agente": o
-- agente muitas vezes so acompanha, e a propria tela promete "minutos sem
-- ninguem do grupo responder". Entao para is_group o filtro de awaiting deixa de
-- valer; o relogio (last_activity) ja e a ultima mensagem do grupo de qualquer
-- lado, carimbada pela trigger trg_track_group_attendance_messages.
--
-- 1:1 nao muda em nada. Grupo desabilitado na aba Grupos continua fora.
-- Unica diferenca em relacao a definicao anterior: a linha do awaiting_agent_since.
CREATE OR REPLACE FUNCTION public.get_inactive_attendances_to_process(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, attendance_code text, tenant_id uuid, conversation_id uuid, contact_id uuid, assigned_to uuid, opened_at timestamp with time zone, last_customer_message_at timestamp with time zone, last_operator_message_at timestamp with time zone, inactivity_warning_sent_at timestamp with time zone, scheduled_until timestamp with time zone, department_id uuid, instance_id uuid, effective_close_min integer, effective_warn_before integer, warn_enabled boolean, needs_warn boolean, needs_close boolean, inactivity_eod_close_at timestamp with time zone, eod_enabled boolean, is_group boolean, group_jid text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      a.id, a.attendance_code, a.tenant_id, a.conversation_id, a.contact_id, a.assigned_to,
      a.opened_at, a.last_customer_message_at, a.last_operator_message_at,
      a.inactivity_warning_sent_at, a.scheduled_until, a.inactivity_eod_close_at,
      conv.department_id, conv.instance_id,
      COALESCE(a.is_group, false) AS is_group, conv.group_jid,
      GREATEST(
        COALESCE(a.last_customer_message_at, a.opened_at),
        COALESCE(a.last_operator_message_at, a.opened_at),
        -- [DEM-0353] Pausa vencida RECOMEÇA o relógio. Sem esta linha o
        -- atendimento sai da pausa com o tempo todo já corrido e encerra no
        -- primeiro ciclo seguinte, sem janela para o cliente.
        COALESCE(a.inactivity_hold_until, a.opened_at),
        a.opened_at
      ) as last_activity
    FROM support_attendances a
    JOIN whatsapp_conversations conv ON conv.id = a.conversation_id
    WHERE a.status = 'in_progress'
      -- Em 1:1, bola com o agente sai da régua (quem cuida é "Agente sem
      -- responder"). Em GRUPO não existe essa segunda régua, então o relógio
      -- corre independente de quem falou por último.
      AND (COALESCE(a.is_group, false) = true OR a.awaiting_agent_since IS NULL)
      AND (a.scheduled_until IS NULL OR a.scheduled_until <= now())
      AND COALESCE(a.inactivity_hold, false) = false
      -- [DEM-0353] Pausa ativa: fora da fila. Mesma forma do scheduled_until.
      AND (a.inactivity_hold_until IS NULL OR a.inactivity_hold_until <= now())
      -- grupo so entra se ainda estiver habilitado na aba Grupos
      AND (
        COALESCE(a.is_group, false) = false
        OR EXISTS (
          SELECT 1 FROM whatsapp_groups g
          WHERE g.tenant_id = a.tenant_id
            AND g.instance_id = conv.instance_id
            AND g.group_jid = conv.group_jid
            AND g.enabled = true
        )
      )
  ),
  resolved AS (
    SELECT
      b.*,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_auto_close_inactivity_minutes, 30)
        ELSE COALESCE(d.auto_close_inactivity_minutes, i.auto_close_inactivity_minutes, c.support_auto_close_inactivity_minutes, 30)
      END as effective_close_min,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_inactivity_warning_before_minutes, 5)
        ELSE COALESCE(d.inactivity_warning_before_minutes, i.inactivity_warning_before_minutes, c.support_inactivity_warning_before_minutes, 5)
      END as effective_warn_before,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_send_inactivity_warning, true)
        ELSE COALESCE(c.support_send_inactivity_warning, true)
      END as warn_enabled,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_inactivity_enabled, false)
        ELSE COALESCE(c.support_inactivity_enabled, true)
      END as inactivity_enabled,
      -- antecipação só faz sentido para quem tem expediente configurado
      (COALESCE(c.support_inactivity_eod_enabled, true) AND COALESCE(c.business_hours_enabled, false)) as eod_enabled,
      EXTRACT(EPOCH FROM (now() - b.last_activity)) / 60.0 as elapsed_min,
      CASE
        WHEN b.inactivity_warning_sent_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (now() - b.inactivity_warning_sent_at)) / 60.0
      END as min_since_warn
    FROM base b
    LEFT JOIN support_departments d ON d.id = b.department_id
    LEFT JOIN whatsapp_instances i ON i.id = b.instance_id
    LEFT JOIN configuracoes c ON c.tenant_id = b.tenant_id
  ),
  flagged AS (
    SELECT
      r.*,
      (r.warn_enabled
       AND r.inactivity_warning_sent_at IS NULL
       AND r.elapsed_min >= GREATEST(0, r.effective_close_min - r.effective_warn_before)
      ) as f_needs_warn,
      (
        (r.warn_enabled AND r.inactivity_warning_sent_at IS NOT NULL
         AND r.min_since_warn >= r.effective_warn_before)
        OR (NOT r.warn_enabled AND r.elapsed_min >= r.effective_close_min)
      ) as f_needs_close,
      (r.inactivity_eod_close_at IS NOT NULL AND r.inactivity_eod_close_at <= now()) as f_eod_due
    FROM resolved r
  )
  SELECT
    f.id, f.attendance_code, f.tenant_id, f.conversation_id, f.contact_id, f.assigned_to,
    f.opened_at, f.last_customer_message_at, f.last_operator_message_at,
    f.inactivity_warning_sent_at, f.scheduled_until,
    f.department_id, f.instance_id,
    f.effective_close_min::int, f.effective_warn_before::int, f.warn_enabled,
    f.f_needs_warn, f.f_needs_close,
    f.inactivity_eod_close_at, f.eod_enabled,
    f.is_group, f.group_jid
  FROM flagged f
  WHERE
    f.inactivity_enabled
    AND (f.f_needs_warn OR f.f_needs_close OR f.f_eod_due OR f.eod_enabled)
  ORDER BY (f.f_needs_warn OR f.f_needs_close OR f.f_eod_due) DESC, f.id ASC
  LIMIT p_limit;
$function$;

-- Grants: a definicao anterior tinha EXECUTE para authenticated e service_role.
-- CREATE OR REPLACE preserva, mas reafirmar custa nada e protege de DROP futuro.
REVOKE ALL ON FUNCTION public.get_inactive_attendances_to_process(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inactive_attendances_to_process(integer) TO authenticated, service_role;
