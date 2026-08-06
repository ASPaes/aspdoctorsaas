-- Revert de 20260806123000_alerta_agente_nao_acende_em_grupo.sql
--
-- Aquela migration partiu de uma premissa ERRADA: a de que o atendimento de
-- grupo nao tinha carimbo de atividade e que a regua de inatividade de grupo
-- criaria awaiting_agent_since em grupo pela primeira vez, acendendo o alerta
-- "agente sem responder" como efeito colateral.
--
-- A premissa caiu na verificacao contra producao em 06/08/2026: a trigger
-- trg_track_group_attendance_messages (AFTER INSERT em whatsapp_messages, nunca
-- versionada no repo) ja carimbava last_customer_message_at e
-- last_operator_message_at em atendimento de grupo, dos dois lados, ignorando
-- system/CSAT. Medido em producao no mesmo dia: 235 atendimentos de grupo com
-- carimbo de cliente, 315 com carimbo de operador, 4 grupos abertos com
-- awaiting_agent_since AGORA e 6 tenants com support_agent_alert_enabled.
--
-- Ou seja: o alerta em grupo ja era comportamento vivo, e a migration anterior
-- o desligou sem ninguem ter pedido. Esta restaura a definicao original da view
-- (a unica diferenca e a condicao is_group no CASE do agent_alert_due_at).
--
-- A regua de inatividade de grupo nao depende disto: ela le awaiting_agent_since
-- para saber de quem e a bola, e nao mexe no alerta.
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
            WHEN ((sa.awaiting_agent_since IS NOT NULL) AND (COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true)) THEN fn_business_due_at(sa.awaiting_agent_since, COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes), wc.tenant_id, wc.department_id)
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
