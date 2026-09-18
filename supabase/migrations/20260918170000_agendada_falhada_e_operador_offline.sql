-- ============================================================================
-- Agendamento: falhada destravada + operador offline vai para o setor (18/09/2026)
--
-- 1. AGENDADA "NAO FOI ENVIADA" FICAVA PRESA. Depois de 5 tentativas o motor
--    marca `failed` (caso real: instancia desconectada, "Connection Closed").
--    A bolha oferecia Reagendar e Cancelar, mas as duas RPCs so aceitavam
--    `pending` e devolviam false sem fazer nada. Agora:
--      - cancelar aceita `pending` e `failed`;
--      - reagendar aceita `failed`: exige horario novo, volta para `pending`
--        e zera as tentativas. Anexo que a limpeza ja apagou (7 dias) nao volta:
--        a RPC explica e pede para agendar de novo.
--
-- 2. NOVO ATENDIMENTO COM QUEM AGENDOU OFFLINE (pedido do Alexandre, 18/09).
--    Antes o atendimento abria com quem agendou mesmo desconectado, e ficava
--    parado no nome dele. Agora, se na hora do disparo ele NAO esta conectado,
--    o atendimento nasce na fila do SETOR DELE (fn_setor_do_operador), sem
--    dono, e a distribuicao escolhe quem atende. A mensagem sai do mesmo jeito.
--    "Conectado" e o mesmo criterio do gatilho de automacao "setor sem
--    ninguem" (fn_automation_try_no_agent): presenca `active` ou `paused` com
--    sinal nos ultimos 20 min. Pausa conta como conectado -- ele volta.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- Reagendar: agora tambem tira da falha.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_reschedule_message(
  p_id              uuid,
  p_scheduled_at    timestamptz DEFAULT NULL,
  p_content         text        DEFAULT NULL,
  p_cancel_if_client_replies boolean DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.whatsapp_scheduled_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.whatsapp_scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.fn_can_manage_scheduled_message(p_id) THEN
    RAISE EXCEPTION 'Sem permissao para alterar este agendamento.' USING ERRCODE = '42501';
  END IF;

  -- `sending` e uma mensagem que o motor ja pegou; `sent`/`canceled` acabaram.
  -- Devolve false para a tela dizer "ja esta saindo".
  IF v_row.status NOT IN ('pending','failed') THEN
    RETURN false;
  END IF;

  -- Falhada: o horario antigo ja passou, entao reagendar exige um novo.
  IF v_row.status = 'failed' THEN
    IF p_scheduled_at IS NULL THEN
      RAISE EXCEPTION 'Escolha um novo horario para reenviar.' USING ERRCODE = '22023';
    END IF;
    IF v_row.message_type NOT IN ('text','template') AND v_row.storage_path IS NULL THEN
      RAISE EXCEPTION 'O anexo desta mensagem ja foi apagado. Cancele e agende de novo com o arquivo.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_scheduled_at IS NOT NULL THEN
    IF p_scheduled_at < now() + interval '1 minute' THEN
      RAISE EXCEPTION 'O horario tem de ser pelo menos 1 minuto no futuro.' USING ERRCODE = '22023';
    END IF;
    IF p_scheduled_at > now() + interval '180 days' THEN
      RAISE EXCEPTION 'O horario nao pode passar de 180 dias.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_content IS NOT NULL THEN
    IF v_row.message_type = 'template' THEN
      IF p_content IS DISTINCT FROM v_row.content THEN
        RAISE EXCEPTION 'O texto do template nao se edita. Cancele e agende de novo.' USING ERRCODE = '22023';
      END IF;
    ELSIF v_row.message_type = 'text' THEN
      IF length(btrim(p_content)) = 0 THEN
        RAISE EXCEPTION 'A mensagem nao pode ficar vazia.' USING ERRCODE = '22023';
      END IF;
      IF length(p_content) > 4096 THEN
        RAISE EXCEPTION 'A mensagem passa de 4096 caracteres.' USING ERRCODE = '22023';
      END IF;
    ELSIF length(p_content) > 1024 THEN
      RAISE EXCEPTION 'A legenda passa de 1024 caracteres.' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.whatsapp_scheduled_messages
     SET status       = 'pending',
         scheduled_at = coalesce(p_scheduled_at, scheduled_at),
         content      = coalesce(p_content, content),
         cancel_if_client_replies = coalesce(p_cancel_if_client_replies, cancel_if_client_replies),
         -- Reagendou depois de falhar? Zera o contador para o motor tentar de
         -- novo a partir do zero.
         attempts     = 0,
         claimed_at   = NULL,
         last_error   = NULL
   WHERE id = p_id;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_reschedule_message(uuid,timestamptz,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reschedule_message(uuid,timestamptz,text,boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Cancelar: agora tambem descarta a falhada.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cancel_scheduled_message(
  p_id     uuid,
  p_reason text DEFAULT 'user'
)
RETURNS TABLE (ok boolean, storage_path text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row public.whatsapp_scheduled_messages%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM public.whatsapp_scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.fn_can_manage_scheduled_message(p_id) THEN
    RAISE EXCEPTION 'Sem permissao para cancelar este agendamento.' USING ERRCODE = '42501';
  END IF;

  IF v_row.status NOT IN ('pending','failed') THEN
    RETURN QUERY SELECT false, NULL::text;
    RETURN;
  END IF;

  UPDATE public.whatsapp_scheduled_messages
     SET status        = 'canceled',
         canceled_at   = now(),
         canceled_by   = public.fn_acting_user(),
         cancel_reason = coalesce(p_reason,'user')
   WHERE id = p_id;

  RETURN QUERY SELECT true, v_row.storage_path;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_cancel_scheduled_message(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cancel_scheduled_message(uuid,text) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Abrir o atendimento do agendamento: quem agendou offline -> fila do setor.
--
-- acao devolvida:
--   opened       -- nasceu com quem agendou (conectado)
--   opened_queue -- nasceu na fila do setor dele (desconectado ou inativo)
--   taken        -- havia um aberto sem dono: passou para quem agendou
--   mine         -- ja estava com quem agendou
--   kept_other   -- esta com outro operador: fica com ele
--   kept_queue   -- havia um aberto sem dono e quem agendou esta offline:
--                   continua na fila
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_open_scheduled_attendance(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row        public.whatsapp_scheduled_messages%ROWTYPE;
  v_conv       record;
  v_att        record;
  v_ativo      boolean;
  v_conectado  boolean;
  v_disponivel boolean;
  v_setor      uuid;
  v_now        timestamptz := now();
  v_att_id     uuid;
  v_acao       text;
BEGIN
  SELECT * INTO v_row FROM public.whatsapp_scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento nao encontrado.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.id, c.tenant_id, c.contact_id, coalesce(c.is_group, false) AS is_group
    INTO v_conv
    FROM public.whatsapp_conversations c
   WHERE c.id = v_row.conversation_id
   FOR UPDATE;

  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'Conversa nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_conv.is_group THEN
    RAISE EXCEPTION 'Novo atendimento agendado nao vale para grupo.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = v_row.created_by
       AND p.tenant_id = v_row.tenant_id
       AND p.status = 'ativo'
  ) INTO v_ativo;

  -- Mesmo criterio do fn_automation_try_no_agent: pausa conta como conectado.
  SELECT EXISTS (
    SELECT 1 FROM public.support_agent_presence pr
     WHERE pr.user_id = v_row.created_by
       AND pr.tenant_id = v_row.tenant_id
       AND pr.status IN ('active','paused')
       AND pr.last_heartbeat_at > v_now - interval '20 minutes'
  ) INTO v_conectado;

  v_disponivel := v_ativo AND v_conectado;

  SELECT a.id, a.status, a.assigned_to
    INTO v_att
    FROM public.support_attendances a
   WHERE a.conversation_id = v_row.conversation_id
     AND a.status IN ('waiting','in_progress')
   ORDER BY a.opened_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_att.id IS NOT NULL THEN
    v_att_id := v_att.id;

    IF v_att.assigned_to = v_row.created_by THEN
      v_acao := 'mine';
    ELSIF v_att.assigned_to IS NOT NULL THEN
      v_acao := 'kept_other';
    ELSIF v_disponivel THEN
      UPDATE public.support_attendances
         SET status      = 'in_progress',
             assigned_to = v_row.created_by,
             assumed_at  = v_now,
             queued_at   = NULL,
             updated_at  = v_now
       WHERE id = v_att.id;

      UPDATE public.whatsapp_conversations
         SET assigned_to = v_row.created_by, status = 'active', updated_at = v_now
       WHERE id = v_row.conversation_id;
      v_acao := 'taken';
    ELSE
      -- Sem dono e quem agendou nao esta: a fila que ja existe resolve.
      v_acao := 'kept_queue';
    END IF;

  ELSIF v_disponivel THEN
    INSERT INTO public.support_attendances (
      tenant_id, conversation_id, contact_id, status, opened_at,
      assigned_to, assumed_at, created_from
    ) VALUES (
      v_row.tenant_id, v_row.conversation_id, v_conv.contact_id, 'in_progress', v_now,
      v_row.created_by, v_now, 'scheduled'
    )
    RETURNING id INTO v_att_id;

    UPDATE public.whatsapp_conversations
       SET status = 'active', assigned_to = v_row.created_by, updated_at = v_now
     WHERE id = v_row.conversation_id;

    v_acao := 'opened';

  ELSE
    -- Offline (ou inativo): fila do setor de quem agendou. A conversa ganha o
    -- setor ANTES do atendimento nascer -- a distribuicao le o setor da
    -- conversa e sai em 'no_department' se ele estiver vazio.
    v_setor := public.fn_setor_do_operador(v_row.created_by, v_row.tenant_id);

    UPDATE public.whatsapp_conversations
       SET status        = 'active',
           assigned_to   = NULL,
           department_id = coalesce(v_setor, department_id),
           updated_at    = v_now
     WHERE id = v_row.conversation_id;

    INSERT INTO public.support_attendances (
      tenant_id, conversation_id, contact_id, status, opened_at,
      department_id, queued_at, last_queue_reason, created_from
    ) VALUES (
      v_row.tenant_id, v_row.conversation_id, v_conv.contact_id, 'waiting', v_now,
      v_setor, v_now, 'agent_offline', 'scheduled'
    )
    RETURNING id INTO v_att_id;

    v_acao := 'opened_queue';
  END IF;

  UPDATE public.whatsapp_scheduled_messages
     SET attendance_id = v_att_id
   WHERE id = p_id;

  RETURN jsonb_build_object('acao', v_acao, 'attendance_id', v_att_id, 'setor', v_setor);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_open_scheduled_attendance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_open_scheduled_attendance(uuid) TO service_role;

COMMIT;
