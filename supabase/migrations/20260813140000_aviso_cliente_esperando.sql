-- Regra 3: cliente esperando resposta avisa o dono do chat (13/08/2026).
--
-- O prazo já existia — agent_alert_due_at, por setor e em horário útil — mas só
-- pintava badge na lista de conversas (ConversationsSidebar.tsx:669). Ninguém era
-- notificado.
--
-- A marca de "já avisei" é uma coluna nova que nasce e morre junto com
-- awaiting_agent_since: assim a mesma espera nunca gera dois avisos, e uma nova
-- espera (cliente volta a escrever depois da resposta) gera um aviso novo.
--
-- ⚠️ O corpo de fn_track_awaiting_agent abaixo veio de PRODUÇÃO
-- (md5 cb4e3b15e150d934d04bc17552c888fe), não do banco local: o local está
-- atrasado e ainda não tem a guarda de 11/08 que impede o alerta de acender com
-- a resposta do operador já visível na tela. A única diferença em relação a prod
-- são as duas linhas `agent_alert_notified_at := NULL`.
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS agent_alert_notified_at timestamptz;

-- Índice parcial: o cron só olha quem está esperando e ainda não foi avisado.
CREATE INDEX IF NOT EXISTS idx_sa_awaiting_nao_avisado
  ON public.support_attendances (awaiting_agent_since)
  WHERE awaiting_agent_since IS NOT NULL AND agent_alert_notified_at IS NULL;


CREATE OR REPLACE FUNCTION public.fn_track_awaiting_agent()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Fechou: limpa
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('closed','inactive_closed') THEN
    NEW.awaiting_agent_since := NULL;
    NEW.agent_alert_notified_at := NULL;
    RETURN NEW;
  END IF;

  -- Agente respondeu (operador alcança o cliente): limpa
  IF NEW.last_operator_message_at IS DISTINCT FROM OLD.last_operator_message_at
     AND NEW.last_operator_message_at IS NOT NULL
     AND (NEW.last_customer_message_at IS NULL
          OR NEW.last_operator_message_at >= NEW.last_customer_message_at) THEN
    NEW.awaiting_agent_since := NULL;
    NEW.agent_alert_notified_at := NULL;
    RETURN NEW;
  END IF;

  -- Cliente mandou e a bola passou pro agente: seta SE vazio (ancora na 1ª)
  IF NEW.last_customer_message_at IS DISTINCT FROM OLD.last_customer_message_at
     AND NEW.last_customer_message_at IS NOT NULL
     AND NEW.awaiting_agent_since IS NULL
     AND NEW.last_customer_message_at > COALESCE(NEW.last_operator_message_at, NEW.opened_at) THEN

    -- Guarda: so acende se a ultima mensagem VISIVEL da conversa for mesmo do
    -- cliente. Index lookup em idx_whatsapp_messages_timestamp
    -- (conversation_id, timestamp DESC) — nao varre a tabela.
    IF NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_messages m
      WHERE m.conversation_id = NEW.conversation_id
        AND m.is_from_me = true
        AND COALESCE(m.message_type,'') NOT IN ('system','reaction')
        AND m.deleted_at IS NULL
        AND m.timestamp >= (
          SELECT max(m2.timestamp)
          FROM public.whatsapp_messages m2
          WHERE m2.conversation_id = NEW.conversation_id
            AND m2.is_from_me = false
            AND COALESCE(m2.message_type,'') NOT IN ('system','reaction')
            AND m2.deleted_at IS NULL
        )
    ) THEN
      NEW.awaiting_agent_since := NEW.last_customer_message_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;


-- O cron. Varre só os vencidos ainda não avisados; a marca sobrevive a reinício.
CREATE OR REPLACE FUNCTION public.fn_notify_awaiting_agent()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_avisados int := 0;
BEGIN
  FOR v_row IN
    SELECT sa.id AS attendance_id, sa.assigned_to, wc.id AS conversation_id, wc.tenant_id,
           COALESCE(ct.name, ct.phone_number, 'Cliente') AS contato
    FROM public.support_attendances sa
    JOIN public.whatsapp_conversations wc ON wc.id = sa.conversation_id
    LEFT JOIN public.whatsapp_contacts ct ON ct.id = wc.contact_id
    LEFT JOIN public.support_departments dept ON dept.id = wc.department_id
    LEFT JOIN public.configuracoes cfg ON cfg.tenant_id = wc.tenant_id
    WHERE sa.awaiting_agent_since IS NOT NULL
      AND sa.agent_alert_notified_at IS NULL
      AND sa.assigned_to IS NOT NULL          -- chat sem dono é assunto da regra 2
      AND sa.status IN ('waiting','in_progress')
      AND COALESCE(dept.agent_alert_enabled, cfg.support_agent_alert_enabled) = true
      AND public.fn_business_due_at(
            sa.awaiting_agent_since,
            COALESCE(dept.agent_alert_minutes, cfg.support_agent_alert_minutes),
            wc.tenant_id, wc.department_id) <= now()
    FOR UPDATE OF sa SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.fn_notify_user(
        v_row.tenant_id, v_row.assigned_to, 'chat_awaiting_reply', 'warning',
        'Cliente esperando resposta',
        v_row.contato,
        '/whatsapp?conversation=' || v_row.conversation_id::text,
        jsonb_build_object('conversation_id', v_row.conversation_id,
                           'attendance_id', v_row.attendance_id),
        v_row.conversation_id);

      UPDATE public.support_attendances
         SET agent_alert_notified_at = now()
       WHERE id = v_row.attendance_id;

      v_avisados := v_avisados + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG '[fn_notify_awaiting_agent] falhou no atendimento %: %', v_row.attendance_id, SQLERRM;
    END;
  END LOOP;

  RETURN jsonb_build_object('avisados', v_avisados);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_notify_awaiting_agent() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_notify_awaiting_agent() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notify_awaiting_agent() TO service_role;
