-- Alerta "agente sem responder" nao acende em GRUPO
--
-- Efeito colateral da regua de inatividade de grupo: para ter relogio, o
-- atendimento de grupo passou a carimbar last_customer_message_at, e o trigger
-- fn_track_awaiting_agent carimba awaiting_agent_since junto. Esta view acende
-- agent_alert_due_at a partir dele — ou seja, os grupos comecariam a piscar o
-- alerta vermelho na sidebar (ConversationsSidebar: isAgentAlert e a ordenacao
-- por agent_alert_due_at) sem ninguem ter pedido.
--
-- support_agent_alert_enabled / agent_alert_minutes sao configuracao de 1:1.
-- Ate existir uma decisao explicita sobre alerta de agente em grupo, a view
-- ignora grupo. Reverter e apagar a condicao is_group da linha do CASE.
--
-- awaiting_agent_since continua sendo devolvido pela view (e util, e e o que
-- tira o grupo da fila de inatividade quando a bola volta pro agente); o que
-- muda e so o alerta visual.
--
-- fila e pills (whatsapp_list_queue / whatsapp_pill_counts) ja filtram
-- is_group = false — nao precisam de mudanca.
CREATE OR REPLACE VIEW public.v_whatsapp_conversations_state AS
 SELECT wc.id AS conversation_id,
    wc.tenant_id,
    wc.status AS conversation_status,
    wc.department_id,
    wc.assigned_to AS conversation_assigned_to,
    wc.last_message_at,
    wc.last_message_preview,
    wc.unread_count,
    wc.opened_out_of_hours,
    wc.opened_out_of_hours_at,
    wc.first_agent_message_at,
    sa.id AS attendance_id,
    sa.status AS attendance_status,
    sa.assigned_to AS attendance_assigned_to,
    sa.opened_at AS attendance_opened_at,
    sa.unidade_base_id AS attendance_unidade_base_id,
    ((sa.msg_customer_count > 0) OR (sa.last_customer_message_at IS NOT NULL)) AS attendance_has_customer_msg,
    sa.awaiting_agent_since,
    COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) AS agent_alert_enabled,
    COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes) AS agent_alert_minutes,
        CASE
            WHEN ((sa.awaiting_agent_since IS NOT NULL) AND (wc.is_group IS NOT TRUE) AND (COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true)) THEN fn_business_due_at(sa.awaiting_agent_since, COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes), wc.tenant_id, wc.department_id)
            ELSE NULL::timestamp with time zone
        END AS agent_alert_due_at,
    wc.is_group
   FROM (((whatsapp_conversations wc
     LEFT JOIN LATERAL ( SELECT s.id,
            s.status,
            s.assigned_to,
            s.opened_at,
            s.unidade_base_id,
            s.msg_customer_count,
            s.last_customer_message_at,
            s.awaiting_agent_since
           FROM support_attendances s
          WHERE ((s.conversation_id = wc.id) AND (s.tenant_id = wc.tenant_id) AND (s.status = ANY (ARRAY['waiting'::text, 'in_progress'::text])))
          ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
         LIMIT 1) sa ON (true))
     LEFT JOIN support_departments dept ON ((dept.id = wc.department_id)))
     LEFT JOIN configuracoes cfg ON ((cfg.tenant_id = wc.tenant_id)));
