-- URA: encerra sozinho o autoatendimento que ficou sem resposta
--
-- Quem escolhe uma opção 'auto_reply' (ex.: Indique e ganhe) recebe o link e
-- fica em ura_state='self_service', sem setor e sem atendente. Se voltar a
-- falar, o motor devolve o menu. Se sumir, é esta RPC que fecha.
--
-- Por que RPC nova e não a fn_close_attendance_atomic que a inatividade usa:
--   1. Aquela exige status='in_progress'. Este atendimento nunca foi assumido,
--      está 'waiting' — ela recusaria com 'not_in_progress'.
--   2. Aquela não mexe em sentiment_at, então o trg_enqueue_attendance_analysis
--      mandaria pra IA um chat de duas mensagens automáticas. Custo à toa.

CREATE OR REPLACE FUNCTION public.fn_close_ura_selfservice(p_limit integer DEFAULT 50)
RETURNS TABLE (
  attendance_id   uuid,
  attendance_code text,
  conversation_id uuid,
  tenant_id       uuid,
  mensagem        text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  r     RECORD;
BEGIN
  FOR r IN
    SELECT sa.id, sa.attendance_code, sa.conversation_id, sa.tenant_id,
           NULLIF(btrim(COALESCE(sd.ura_auto_close_message, '')), '') AS msg
    FROM public.support_attendances sa
    JOIN public.support_departments sd
      ON sd.tenant_id        = sa.tenant_id
     AND sd.ura_option_number = sa.ura_option_selected
     AND sd.ura_action        = 'auto_reply'
     AND sd.is_active         = true
     AND sd.show_in_ura       = true
    WHERE sa.status     = 'waiting'
      AND sa.assigned_to IS NULL
      AND sa.ura_state  = 'self_service'
      AND sa.ura_completed_at IS NOT NULL
      AND sa.ura_completed_at < v_now - make_interval(mins => COALESCE(sd.ura_auto_close_minutes, 3))
      -- "Não houve mais interação" é lido no ESTADO, não em last_customer_message_at.
      -- Comparar timestamps não funciona aqui: quem grava last_customer_message_at é
      -- o incrementAttendanceCounter, que roda DEPOIS do motor marcar o
      -- autoatendimento — a mensagem que escolheu a opção sempre ficaria mais nova
      -- que ura_completed_at, e nada fecharia nunca.
      -- Quem volta a falar sai de 'self_service' pelo próprio motor, que devolve o
      -- menu e põe o atendimento em 'pending'.
    ORDER BY sa.ura_completed_at
    LIMIT p_limit
    FOR UPDATE OF sa SKIP LOCKED
  LOOP
    UPDATE public.support_attendances
       SET status        = 'closed',
           closed_at     = v_now,
           closed_reason = 'ura_autoatendimento',
           closure_type  = 'ura_autoatendimento',
           -- Desliga a análise de sentimento: trg_enqueue_attendance_analysis
           -- só enfileira quando sentiment_at é NULL.
           sentiment_at  = COALESCE(sentiment_at, v_now),
           -- Sai de 'self_service' ao fechar. É isso que impede o reencerramento:
           -- se o cliente voltar dentro da janela de reabertura, o atendimento
           -- volta a 'waiting' com o ura_completed_at velho — e sem esta troca de
           -- estado ele seria fechado de novo, com outra despedida, no ciclo
           -- seguinte do cron.
           ura_state     = 'self_service_closed',
           updated_at    = v_now
     WHERE id = r.id;

    -- Grupo nunca tem a conversa fechada (mesma regra da fn_close_attendance_atomic).
    -- tenant_id vai qualificado: sem isso o Postgres não sabe se é a coluna ou o
    -- parâmetro de saída de mesmo nome, e recusa a função em tempo de execução.
    UPDATE public.whatsapp_conversations
       SET status = 'closed', updated_at = v_now
     WHERE whatsapp_conversations.id = r.conversation_id
       AND whatsapp_conversations.tenant_id = r.tenant_id
       AND COALESCE(whatsapp_conversations.is_group, false) = false;

    attendance_id   := r.id;
    attendance_code := r.attendance_code;
    conversation_id := r.conversation_id;
    tenant_id       := r.tenant_id;
    mensagem        := r.msg;
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- Só o cron (via edge function com service_role) chama isto. Nenhuma tela chama.
REVOKE ALL ON FUNCTION public.fn_close_ura_selfservice(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_close_ura_selfservice(integer) FROM anon;
REVOKE ALL ON FUNCTION public.fn_close_ura_selfservice(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_close_ura_selfservice(integer) TO service_role;

-- O índice parcial que sustenta a varredura do cron NÃO entra aqui: CREATE
-- INDEX CONCURRENTLY não roda dentro de transação. Ele vai por execute_sql:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_att_ura_self_service
--     ON public.support_attendances (ura_completed_at)
--     WHERE status = 'waiting' AND ura_state = 'self_service';
