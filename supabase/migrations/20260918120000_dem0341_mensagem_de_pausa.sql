-- DEM-0341 — Mensagem automática quando o responsável pelo chat está em pausa.
--
-- 1. support_pause_reasons.auto_message: texto opcional por motivo. Vazio = comportamento
--    antigo (nada é enviado).
-- 2. support_pause_notices: um aviso por (conversa, atendente, pausa). A chave da pausa é
--    support_agent_presence.pause_started_at, que muda a cada pausa. É o que garante "uma
--    vez por pausa" sem escrever em whatsapp_conversations (que está no realtime).
-- 3. try_claim_pause_notice: chamada pelo message-processor depois do bloco de horário
--    comercial. Confere tudo e reivindica o aviso de forma atômica numa ida só ao banco.
-- 4. Gatilho em support_agent_presence: quando o status SAI de 'paused', por qualquer
--    caminho (set_active, admin_set_status, set_off, set_off_release_queue, queda por
--    inatividade), grava "voltou da pausa" como linha de sistema nos chats avisados.
--    Um gatilho só em vez de mexer nas 5 RPCs.

-- ─── 1. Texto por motivo ────────────────────────────────────────────────────
ALTER TABLE public.support_pause_reasons
  ADD COLUMN IF NOT EXISTS auto_message text;

ALTER TABLE public.support_pause_reasons
  DROP CONSTRAINT IF EXISTS support_pause_reasons_auto_message_len;
ALTER TABLE public.support_pause_reasons
  ADD CONSTRAINT support_pause_reasons_auto_message_len
  CHECK (auto_message IS NULL OR char_length(auto_message) <= 1000);

-- ─── 2. Extrato de avisos ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_pause_notices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  conversation_id  uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  attendance_id    uuid REFERENCES public.support_attendances(id) ON DELETE SET NULL,
  user_id          uuid NOT NULL,
  pause_reason_id  uuid REFERENCES public.support_pause_reasons(id) ON DELETE SET NULL,
  pause_started_at timestamptz NOT NULL,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  returned_at      timestamptz,
  CONSTRAINT support_pause_notices_uniq UNIQUE (conversation_id, user_id, pause_started_at)
);

CREATE INDEX IF NOT EXISTS idx_support_pause_notices_open
  ON public.support_pause_notices (tenant_id, user_id)
  WHERE returned_at IS NULL;

ALTER TABLE public.support_pause_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_pause_notices_select ON public.support_pause_notices;
CREATE POLICY support_pause_notices_select ON public.support_pause_notices
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
    OR public.is_super_admin() IS TRUE
  );
-- Sem policy de escrita: só a RPC e o gatilho (SECURITY DEFINER) escrevem.

-- ─── 3. Reivindicar o aviso ─────────────────────────────────────────────────
-- Devolve {message, attendance_id, user_id} quando o aviso deve sair AGORA, ou NULL.
-- O INSERT ... ON CONFLICT DO NOTHING é a trava: duas mensagens do cliente chegando
-- juntas geram um aviso só.
CREATE OR REPLACE FUNCTION public.try_claim_pause_notice(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_att      record;
  v_pres     record;
  v_message  text;
  v_id       uuid;
BEGIN
  SELECT a.id, a.tenant_id, a.assigned_to
    INTO v_att
    FROM public.support_attendances a
   WHERE a.conversation_id = p_conversation_id
     AND a.status = 'in_progress'
     AND a.assigned_to IS NOT NULL
   ORDER BY a.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT sp.pause_reason_id, sp.pause_started_at
    INTO v_pres
    FROM public.support_agent_presence sp
   WHERE sp.tenant_id = v_att.tenant_id
     AND sp.user_id = v_att.assigned_to
     AND sp.status = 'paused'
     AND sp.pause_started_at IS NOT NULL;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- is_active do motivo não entra: a pausa já foi escolhida; desativar o motivo depois
  -- não deveria calar quem está nela.
  SELECT nullif(btrim(r.auto_message), '')
    INTO v_message
    FROM public.support_pause_reasons r
   WHERE r.id = v_pres.pause_reason_id;
  IF v_message IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.support_pause_notices
    (tenant_id, conversation_id, attendance_id, user_id, pause_reason_id, pause_started_at)
  VALUES
    (v_att.tenant_id, p_conversation_id, v_att.id, v_att.assigned_to,
     v_pres.pause_reason_id, v_pres.pause_started_at)
  ON CONFLICT (conversation_id, user_id, pause_started_at) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;

  RETURN jsonb_build_object(
    'notice_id',     v_id,
    'message',       v_message,
    'attendance_id', v_att.id,
    'user_id',       v_att.assigned_to
  );
END;
$$;

REVOKE ALL ON FUNCTION public.try_claim_pause_notice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_pause_notice(uuid) TO service_role;

-- ─── 4. Retorno da pausa no chat ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_pause_notice_on_presence_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome    text;
  v_content text;
  n         record;
BEGIN
  BEGIN
    SELECT f.nome INTO v_nome
      FROM public.profiles p
      JOIN public.funcionarios f ON f.id = p.funcionario_id
     WHERE p.user_id = NEW.user_id
     LIMIT 1;

    v_content := CASE WHEN NEW.status = 'active'
      THEN '↩️ ' || coalesce(v_nome, 'O atendente') || ' voltou da pausa.'
      ELSE '↩️ ' || coalesce(v_nome, 'O atendente') || ' saiu da pausa e encerrou o expediente.'
    END;

    -- Troca de motivo (pausa → pausa) não chega aqui: o gatilho só roda quando o status
    -- sai de 'paused'. Os avisos da pausa anterior continuam abertos e fecham juntos agora.
    FOR n IN
      UPDATE public.support_pause_notices
         SET returned_at = now()
       WHERE tenant_id = NEW.tenant_id
         AND user_id = NEW.user_id
         AND returned_at IS NULL
      RETURNING id, conversation_id
    LOOP
      INSERT INTO public.whatsapp_messages
        (conversation_id, remote_jid, message_id, content, message_type,
         is_from_me, status, timestamp, tenant_id, metadata)
      VALUES
        (n.conversation_id, '', 'system_pause_end_' || n.id, v_content, 'system',
         false, 'sent', now(), NEW.tenant_id,
         jsonb_build_object('system', true, 'pause_event', 'ended',
                            'user_id', NEW.user_id, 'new_status', NEW.status))
      ON CONFLICT (tenant_id, message_id) DO NOTHING;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca derrubar a troca de status do atendente por causa do aviso.
    RAISE WARNING 'fn_pause_notice_on_presence_change: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_pause_notice_on_presence_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_pause_notice_on_presence_change ON public.support_agent_presence;
CREATE TRIGGER trg_pause_notice_on_presence_change
  AFTER UPDATE OF status ON public.support_agent_presence
  FOR EACH ROW
  WHEN (OLD.status = 'paused' AND NEW.status IS DISTINCT FROM 'paused')
  EXECUTE FUNCTION public.fn_pause_notice_on_presence_change();
