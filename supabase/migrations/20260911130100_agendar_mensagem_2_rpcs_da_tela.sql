-- ============================================================================
-- Mensagem agendada no chat -- 2/3, as RPCs da tela  (11/09/2026)
--
-- A tabela (1/3) nao tem policy de escrita: `authenticated` so le. Toda escrita
-- entra por aqui, que e onde mora a regra de QUEM pode mexer:
--
--   quem agendou  +  quem esta com o atendimento  +  admin/head do tenant
--   +  super admin
--
-- (decisao do Alexandre em 11/09: quem assumiu a conversa tem de poder desarmar
-- a mensagem, porque e ele que leva a bronca se sair coisa errada.)
--
-- O AVISO de "fora do horario comercial" NAO esta aqui de proposito: a decisao
-- foi avisar e sugerir, nunca bloquear. Quem avisa e a tela, lendo
-- `configuracoes.business_hours` com o `parseBusinessHours` que ja existe em
-- WeeklyScheduleGrid.tsx. Colocar a regra no banco criaria uma segunda fonte
-- de verdade do horario.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- Quem pode mexer numa agendada. Usada pelas duas RPCs de escrita.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_can_manage_scheduled_message(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me  uuid := public.fn_acting_user();
  v_row public.whatsapp_scheduled_messages%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_row FROM public.whatsapp_scheduled_messages WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Super admin passa. `is_super_admin()` devolve NULL quando a RLS de profiles
  -- nao deixa ler o proprio perfil -- coalesce para NULL nao virar "sim".
  IF coalesce(public.is_super_admin(), false) THEN
    RETURN true;
  END IF;

  -- Autor
  IF v_row.created_by = v_me THEN
    RETURN true;
  END IF;

  -- Dono do atendimento aberto da conversa
  IF EXISTS (
    SELECT 1 FROM public.support_attendances a
     WHERE a.conversation_id = v_row.conversation_id
       AND a.assigned_to = v_me
       AND a.status IN ('waiting','in_progress')
  ) THEN
    RETURN true;
  END IF;

  -- Gestao do mesmo tenant
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = v_me
       AND p.tenant_id = v_row.tenant_id
       AND p.role IN ('admin','head')
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_can_manage_scheduled_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_manage_scheduled_message(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Agendar. Devolve o id da linha criada.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_schedule_message(
  p_conversation_id uuid,
  p_scheduled_at    timestamptz,
  p_content         text    DEFAULT '',
  p_message_type    text    DEFAULT 'text',
  p_storage_path    text    DEFAULT NULL,
  p_media_mimetype  text    DEFAULT NULL,
  p_media_file_name text    DEFAULT NULL,
  p_media_size_bytes bigint DEFAULT NULL,
  p_cancel_if_client_replies boolean DEFAULT false,
  p_instance_id     uuid    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me        uuid := public.fn_acting_user();
  v_tenant    uuid;
  v_pendentes int;
  v_id        uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessao sem usuario identificado.' USING ERRCODE = '42501';
  END IF;

  SELECT c.tenant_id INTO v_tenant
    FROM public.whatsapp_conversations c
   WHERE c.id = p_conversation_id;

  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Conversa nao encontrada.' USING ERRCODE = 'P0002';
  END IF;

  -- Acesso a conversa: mesmo tenant do perfil, ou super admin simulando.
  IF NOT coalesce(public.is_super_admin(), false)
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.user_id = v_me AND p.tenant_id = v_tenant
     )
  THEN
    RAISE EXCEPTION 'Sem permissao para esta conversa.' USING ERRCODE = '42501';
  END IF;

  -- Janela do agendamento. O piso de 1 minuto evita a corrida com o cron (que
  -- roda */1): agendar para "daqui a 3 segundos" e pedir para o motor disputar
  -- com a propria tela. Para sair agora existe o botao de enviar.
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() + interval '1 minute' THEN
    RAISE EXCEPTION 'O horario tem de ser pelo menos 1 minuto no futuro.' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_at > now() + interval '180 days' THEN
    RAISE EXCEPTION 'O horario nao pode passar de 180 dias.' USING ERRCODE = '22023';
  END IF;

  -- Limites do WhatsApp: 4096 no texto, 1024 na legenda de midia.
  IF p_message_type = 'text' AND length(p_content) > 4096 THEN
    RAISE EXCEPTION 'A mensagem passa de 4096 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_message_type <> 'text' AND length(coalesce(p_content,'')) > 1024 THEN
    RAISE EXCEPTION 'A legenda passa de 1024 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- Teto por conversa. Nao e regra de negocio, e freio de engano: 20 agendadas
  -- vivas na mesma conversa ja indica uso errado.
  SELECT count(*) INTO v_pendentes
    FROM public.whatsapp_scheduled_messages
   WHERE conversation_id = p_conversation_id
     AND status IN ('pending','sending');

  IF v_pendentes >= 20 THEN
    RAISE EXCEPTION 'Esta conversa ja tem 20 mensagens agendadas.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.whatsapp_scheduled_messages (
    tenant_id, conversation_id, instance_id, created_by,
    content, message_type,
    storage_path, media_mimetype, media_file_name, media_size_bytes,
    scheduled_at, cancel_if_client_replies
  ) VALUES (
    v_tenant, p_conversation_id, p_instance_id, v_me,
    coalesce(p_content,''), p_message_type,
    p_storage_path, p_media_mimetype, p_media_file_name, p_media_size_bytes,
    p_scheduled_at, coalesce(p_cancel_if_client_replies,false)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_schedule_message(uuid,timestamptz,text,text,text,text,text,bigint,boolean,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_schedule_message(uuid,timestamptz,text,text,text,text,text,bigint,boolean,uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Reagendar / reescrever. Parametro NULL = nao mexe naquele campo.
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

  -- `sending` e uma mensagem que o motor ja pegou: editar agora seria editar o
  -- que esta saindo. Devolve false para a tela dizer "ja esta saindo".
  IF v_row.status <> 'pending' THEN
    RETURN false;
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
    IF v_row.message_type = 'text' THEN
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
     SET scheduled_at = coalesce(p_scheduled_at, scheduled_at),
         content      = coalesce(p_content, content),
         cancel_if_client_replies = coalesce(p_cancel_if_client_replies, cancel_if_client_replies),
         -- Reagendou depois de falhar? Zera o contador para o motor tentar de
         -- novo a partir do zero.
         attempts     = 0,
         last_error   = NULL
   WHERE id = p_id;

  RETURN true;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_reschedule_message(uuid,timestamptz,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reschedule_message(uuid,timestamptz,text,boolean) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Cancelar. Devolve o storage_path do anexo orfao (ou NULL) para quem chamou
-- saber que sobrou arquivo -- quem apaga do Storage e o motor, que tem
-- service_role. A tela nao apaga arquivo.
--
-- `p_reason` conhecido: 'user' (padrao) e 'sent_now' (o operador mandou a
-- mensagem na hora, entao o agendamento morre porque ela ja saiu).
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

  IF v_row.status <> 'pending' THEN
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

COMMIT;
