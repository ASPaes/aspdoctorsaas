-- ============================================================================
-- Agendar novo atendimento -- DEM-0423  (18/09/2026)
--
-- O QUE E: uma escolha a mais na aba "Agendar" do chat. Alem de "mensagem
-- nesta conversa" (o que ja existia), o operador pode agendar um NOVO
-- ATENDIMENTO: na hora marcada a mensagem sai e o atendimento abre ja
-- atribuido a quem agendou, na fila "Meus" dele.
--
--   * Canal API Meta: so vai TEMPLATE. Fora da janela de 24h a Meta recusa
--     texto livre, e o retorno agendado quase sempre cai fora dela.
--   * Canal espelhado (Evolution / Z-API): texto livre ou anexo, como hoje.
--
-- Decisoes do Alexandre (17/09) para a hora do disparo:
--   1. Atendimento ainda aberto e sem dono (ou com quem agendou): a mensagem
--      sai nele mesmo e ele passa para quem agendou. Nao abre um segundo.
--   2. Atendimento aberto com OUTRO operador: a mensagem sai mesmo assim e o
--      atendimento continua com quem esta.
--   3. Fora do expediente: avisa e sugere, nunca bloqueia (e da tela).
--
-- O motor continua sendo o mesmo cron (dispatch-scheduled-messages). Quem abre
-- o atendimento e a `fn_open_scheduled_attendance`, chamada pelo motor ANTES
-- de enviar -- mesma ordem da send-whatsapp-message, para o eco do webhook
-- achar o atendimento ja com dono e nao abrir um orfao na fila.
--
-- `created_from = 'scheduled'`: nao tem CHECK na coluna. A saudacao de
-- atribuicao (fn_enqueue_assignment_greeting) so roda para customer /
-- out_of_hours / billing_automation, entao o cliente nao recebe "ola, sou o
-- fulano" antes do template. O setor e carimbado pelo fn_setor_segue_o_agente.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- Colunas novas
-- ----------------------------------------------------------------------------
ALTER TABLE public.whatsapp_scheduled_messages
  ADD COLUMN IF NOT EXISTS opens_attendance    boolean NOT NULL DEFAULT false,
  -- Sem FK de proposito: template apagado com agendamento pendente vira falha
  -- legivel no motor ("template nao encontrado"), em vez de o DELETE do
  -- template esbarrar no CHECK desta tabela.
  ADD COLUMN IF NOT EXISTS template_id         uuid,
  ADD COLUMN IF NOT EXISTS template_parameters jsonb,
  -- Atendimento que o disparo abriu ou adotou. Sem FK, como sent_message_id.
  ADD COLUMN IF NOT EXISTS attendance_id       uuid;

COMMENT ON COLUMN public.whatsapp_scheduled_messages.opens_attendance IS
  'true = no disparo, abre (ou adota) um atendimento para quem agendou antes de enviar. DEM-0423.';
COMMENT ON COLUMN public.whatsapp_scheduled_messages.template_id IS
  'Template Meta (whatsapp_meta_templates.id) quando message_type = template. O content guarda o texto ja montado, so para a tela.';
COMMENT ON COLUMN public.whatsapp_scheduled_messages.attendance_id IS
  'Atendimento aberto ou adotado pelo disparo (opens_attendance). Preenchido pela fn_open_scheduled_attendance.';

ALTER TABLE public.whatsapp_scheduled_messages DROP CONSTRAINT IF EXISTS wa_sched_type_chk;
ALTER TABLE public.whatsapp_scheduled_messages
  ADD CONSTRAINT wa_sched_type_chk
  CHECK (message_type IN ('text','image','video','document','audio','template'));

ALTER TABLE public.whatsapp_scheduled_messages DROP CONSTRAINT IF EXISTS wa_sched_payload_chk;
ALTER TABLE public.whatsapp_scheduled_messages
  ADD CONSTRAINT wa_sched_payload_chk CHECK (
    (
      message_type = 'text'
      AND length(btrim(content)) > 0
      AND storage_path IS NULL
    )
    OR (
      message_type = 'template'
      AND template_id IS NOT NULL
      AND storage_path IS NULL
    )
    OR (
      message_type NOT IN ('text','template')
      AND media_mimetype IS NOT NULL
      AND (storage_path IS NOT NULL OR status IN ('sent','canceled','failed'))
    )
  );

-- ----------------------------------------------------------------------------
-- Agendar. A assinatura muda (3 parametros novos no fim, todos com default),
-- entao a antiga sai antes: CREATE OR REPLACE com argumentos a mais criaria
-- uma SOBRECARGA, e toda chamada da tela ficaria ambigua.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.fn_schedule_message(uuid,timestamptz,text,text,text,text,text,bigint,boolean,uuid);

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
  p_instance_id     uuid    DEFAULT NULL,
  p_opens_attendance boolean DEFAULT false,
  p_template_id     uuid    DEFAULT NULL,
  p_template_parameters jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me        uuid := public.fn_acting_user();
  v_tenant    uuid;
  v_is_group  boolean;
  v_inst      uuid;
  v_provider  text;
  v_tpl       record;
  v_pendentes int;
  v_id        uuid;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sessao sem usuario identificado.' USING ERRCODE = '42501';
  END IF;

  SELECT c.tenant_id, coalesce(c.is_group, false), c.instance_id
    INTO v_tenant, v_is_group, v_inst
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

  -- Instancia do disparo: a escolhida, senao a da conversa. O motor faz a
  -- mesma escolha; aqui ela serve para saber se o canal e Meta.
  SELECT i.provider_type INTO v_provider
    FROM public.whatsapp_instances i
   WHERE i.id = coalesce(p_instance_id, v_inst);

  IF coalesce(p_opens_attendance, false) THEN
    -- Atendimento de grupo tem regra propria (start_group_attendance, aviso
    -- no grupo). Fora do escopo da DEM-0423.
    IF v_is_group THEN
      RAISE EXCEPTION 'Novo atendimento agendado nao vale para grupo.' USING ERRCODE = '22023';
    END IF;
    IF v_provider = 'meta_cloud' AND p_message_type <> 'template' THEN
      RAISE EXCEPTION 'No canal da API Meta o novo atendimento precisa de um template.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_message_type = 'template' THEN
    IF v_provider IS DISTINCT FROM 'meta_cloud' THEN
      RAISE EXCEPTION 'Template so pode ser agendado em canal da API Meta.' USING ERRCODE = '22023';
    END IF;

    SELECT t.id, t.tenant_id, t.instance_id, t.status
      INTO v_tpl
      FROM public.whatsapp_meta_templates t
     WHERE t.id = p_template_id;

    IF v_tpl.id IS NULL THEN
      RAISE EXCEPTION 'Template nao encontrado.' USING ERRCODE = 'P0002';
    END IF;
    IF v_tpl.tenant_id <> v_tenant OR v_tpl.instance_id <> coalesce(p_instance_id, v_inst) THEN
      RAISE EXCEPTION 'Este template nao pertence ao numero da conversa.' USING ERRCODE = '22023';
    END IF;
    IF v_tpl.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'O template ainda nao foi aprovado pela Meta.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_template_id IS NOT NULL THEN
    RAISE EXCEPTION 'Template informado com tipo de mensagem %.', p_message_type USING ERRCODE = '22023';
  END IF;

  -- Limites do WhatsApp: 4096 no texto, 1024 na legenda de midia. No template
  -- o content e so o texto montado para a tela; quem limita e a propria Meta.
  IF p_message_type = 'text' AND length(p_content) > 4096 THEN
    RAISE EXCEPTION 'A mensagem passa de 4096 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_message_type NOT IN ('text','template') AND length(coalesce(p_content,'')) > 1024 THEN
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
    scheduled_at, cancel_if_client_replies,
    opens_attendance, template_id, template_parameters
  ) VALUES (
    v_tenant, p_conversation_id, p_instance_id, v_me,
    coalesce(p_content,''), p_message_type,
    p_storage_path, p_media_mimetype, p_media_file_name, p_media_size_bytes,
    p_scheduled_at, coalesce(p_cancel_if_client_replies,false),
    coalesce(p_opens_attendance,false), p_template_id, p_template_parameters
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_schedule_message(uuid,timestamptz,text,text,text,text,text,bigint,boolean,uuid,boolean,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_schedule_message(uuid,timestamptz,text,text,text,text,text,bigint,boolean,uuid,boolean,uuid,jsonb) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Reagendar: igual ao de 11/09, com uma trava -- o texto do template nao se
-- edita (e o texto aprovado pela Meta; o que muda sao as variaveis, e para
-- isso o operador cancela e agenda de novo).
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
-- Abre (ou adota) o atendimento de um agendamento. So o motor chama.
--
-- Idempotente: o motor pode tentar a mesma linha ate 5 vezes. Na 2a tentativa
-- o atendimento ja esta aberto e com quem agendou, e cai no caso "mine".
--
-- Devolve jsonb { acao, attendance_id }:
--   opened       -- nao havia atendimento aberto: nasceu um, com quem agendou
--   opened_queue -- idem, mas quem agendou esta inativo: nasce na fila e a
--                   distribuicao escolhe (mesma regra da reabertura orfa)
--   taken        -- havia um aberto sem dono: passou para quem agendou (dec. 1)
--   mine         -- ja estava com quem agendou
--   kept_other   -- esta com outro operador: fica com ele (dec. 2)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_open_scheduled_attendance(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row    public.whatsapp_scheduled_messages%ROWTYPE;
  v_conv   record;
  v_att    record;
  v_ativo  boolean;
  v_now    timestamptz := now();
  v_att_id uuid;
  v_acao   text;
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
    ELSIF v_ativo THEN
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
      -- Sem dono e quem agendou saiu da empresa: deixa a fila resolver.
      v_acao := 'kept_other';
    END IF;
  ELSE
    INSERT INTO public.support_attendances (
      tenant_id, conversation_id, contact_id, status, opened_at,
      assigned_to, assumed_at, queued_at, created_from
    ) VALUES (
      v_row.tenant_id, v_row.conversation_id, v_conv.contact_id,
      CASE WHEN v_ativo THEN 'in_progress' ELSE 'waiting' END,
      v_now,
      CASE WHEN v_ativo THEN v_row.created_by END,
      CASE WHEN v_ativo THEN v_now END,
      CASE WHEN v_ativo THEN NULL ELSE v_now END,
      'scheduled'
    )
    RETURNING id INTO v_att_id;

    UPDATE public.whatsapp_conversations
       SET status      = 'active',
           assigned_to = CASE WHEN v_ativo THEN v_row.created_by ELSE assigned_to END,
           updated_at  = v_now
     WHERE id = v_row.conversation_id;

    v_acao := CASE WHEN v_ativo THEN 'opened' ELSE 'opened_queue' END;
  END IF;

  UPDATE public.whatsapp_scheduled_messages
     SET attendance_id = v_att_id
   WHERE id = p_id;

  RETURN jsonb_build_object('acao', v_acao, 'attendance_id', v_att_id);
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_open_scheduled_attendance(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_open_scheduled_attendance(uuid) TO service_role;

COMMIT;
