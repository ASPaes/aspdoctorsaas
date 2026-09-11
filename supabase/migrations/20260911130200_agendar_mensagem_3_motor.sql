-- ============================================================================
-- Mensagem agendada no chat -- 3/3, o motor  (11/09/2026)
--
-- Duas RPCs que SO o service_role chama (a edge function
-- dispatch-scheduled-messages). A tela nao tem nada a fazer aqui, e o banco
-- tem ALTER DEFAULT PRIVILEGES dando EXECUTE a `authenticated` em toda funcao
-- nova do schema public -- entao o REVOKE explicito abaixo nao e decoracao, e
-- o que impede um usuario logado de marcar a mensagem dos outros como enviada.
--
-- POR QUE O CLAIM: o cron roda */1 e uma execucao pode demorar mais de um
-- minuto (envio por HTTP para a Evolution/Meta/Z-API). Sem marcar a linha, a
-- execucao seguinte pegaria a mesma mensagem e o cliente receberia duas vezes.
-- `sending` + `claimed_at` resolve, e a janela de 10 minutos devolve para a
-- fila a linha do isolate que morreu no meio.
-- ============================================================================
BEGIN;

-- ----------------------------------------------------------------------------
-- Pega o lote do minuto. Antes de pegar, mata as que o cliente respondeu.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_claim_due_scheduled_messages(p_limit int DEFAULT 25)
RETURNS SETOF public.whatsapp_scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  -- "Cancelar se o cliente responder antes". A comparacao e com `updated_at`,
  -- nao com `created_at`: quem reagendou/reescreveu renovou a intencao, e uma
  -- resposta anterior a essa edicao nao deve matar a mensagem nova. Em linha
  -- pending o `updated_at` so muda por mao de operador.
  UPDATE public.whatsapp_scheduled_messages s
     SET status        = 'canceled',
         canceled_at   = now(),
         cancel_reason = 'client_replied'
   WHERE s.status = 'pending'
     AND s.scheduled_at <= now()
     AND s.cancel_if_client_replies
     AND EXISTS (
       SELECT 1 FROM public.whatsapp_messages m
        WHERE m.conversation_id = s.conversation_id
          AND m.is_from_me = false
          AND m.timestamp > s.updated_at
     );

  RETURN QUERY
  UPDATE public.whatsapp_scheduled_messages s
     SET status     = 'sending',
         claimed_at = now(),
         attempts   = s.attempts + 1
   WHERE s.id IN (
     SELECT x.id
       FROM public.whatsapp_scheduled_messages x
      WHERE (x.status = 'pending' AND x.scheduled_at <= now())
         -- Resgate: linha presa em `sending` e execucao que morreu antes de
         -- dar o veredito. 10 min e folga larga para o envio mais lento.
         OR (x.status = 'sending' AND x.claimed_at < now() - interval '10 minutes')
      ORDER BY x.scheduled_at
      LIMIT greatest(1, least(coalesce(p_limit, 25), 200))
        FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_claim_due_scheduled_messages(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_due_scheduled_messages(int) TO service_role;

-- ----------------------------------------------------------------------------
-- Veredito de uma linha do lote.
--
-- Falhou e ainda tem tentativa? Volta para `pending` com espera crescente --
-- instancia caindo e voltando e o caso comum, e 5 tentativas cobrem ~30 min.
-- Esgotou? Vira `failed` e o AUTOR e avisado no sino, com link para a conversa.
-- Ninguem mais e avisado: a mensagem era dele.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_finish_scheduled_message(
  p_id         uuid,
  p_ok         boolean,
  p_message_id uuid DEFAULT NULL,
  p_error      text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row   public.whatsapp_scheduled_messages%ROWTYPE;
  v_atraso interval;
BEGIN
  SELECT * INTO v_row FROM public.whatsapp_scheduled_messages WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'nao_encontrada';
  END IF;

  IF p_ok THEN
    UPDATE public.whatsapp_scheduled_messages
       SET status = 'sent', sent_at = now(), sent_message_id = p_message_id,
           last_error = NULL, claimed_at = NULL
     WHERE id = p_id;
    RETURN 'sent';
  END IF;

  IF v_row.attempts < 5 THEN
    -- 2, 4, 6, 8 min depois da tentativa que falhou.
    v_atraso := (v_row.attempts * interval '2 minutes');
    UPDATE public.whatsapp_scheduled_messages
       SET status       = 'pending',
           scheduled_at = now() + v_atraso,
           claimed_at   = NULL,
           last_error   = left(coalesce(p_error,'erro sem descricao'), 500)
     WHERE id = p_id;
    RETURN 'retry';
  END IF;

  UPDATE public.whatsapp_scheduled_messages
     SET status     = 'failed',
         claimed_at = NULL,
         last_error = left(coalesce(p_error,'erro sem descricao'), 500)
   WHERE id = p_id;

  PERFORM public.fn_notify_user(
    v_row.tenant_id,
    v_row.created_by,
    'scheduled_message_failed',
    'warning',
    'Mensagem agendada nao foi enviada',
    'A mensagem que voce agendou para ' ||
      to_char(v_row.scheduled_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') ||
      ' falhou depois de 5 tentativas. Abra a conversa para reenviar.',
    '/whatsapp?conversation=' || v_row.conversation_id::text,
    jsonb_build_object(
      'scheduled_message_id', v_row.id,
      'last_error', left(coalesce(p_error,''), 200)
    ),
    v_row.conversation_id
  );

  RETURN 'failed';
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_finish_scheduled_message(uuid,boolean,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finish_scheduled_message(uuid,boolean,uuid,text) TO service_role;

COMMIT;
