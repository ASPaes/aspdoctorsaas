-- ============================================================================
-- Envio em lote pelo WhatsApp (DEM-0492) -- 3/3, o motor  (30/09/2026)
--
-- Duas mudancas no motor das mensagens agendadas. Corpos partem da versao de
-- PRODUCAO lida em 30/09 (pg_get_functiondef), nao do repo nem do banco local.
--
-- 1. CLAIM COM ANTECEDENCIA, so para linha de lote.
--    O cron roda 1x por minuto. Sem isto, as mensagens de um lote que vencem
--    dentro do mesmo minuto sairiam juntas no tique -- e o intervalo de 5 a 30 s
--    entre elas viraria rajada. Com `p_antecedencia_s`, o motor pega a linha de
--    lote ate N segundos antes e ESPERA o segundo exato para enviar.
--    Linha que nao e de lote continua exatamente como antes (antecedencia 0):
--    o "cancelar se o cliente responder" dela e checado na hora do claim, e
--    pegar cedo abriria uma janela sem essa checagem.
--
--    Ordem segura do deploy: esta migration ANTES da edge function. A funcao
--    velha e trocada por uma com o 2o parametro opcional (default 0), entao a
--    edge function que esta no ar -- que chama so com p_limit -- continua
--    funcionando igual ate a nova subir.
--
-- 2. SINO: linha de lote que falha de vez NAO avisa uma a uma (81 grupos = ate
--    81 avisos). Quando o lote termina com falha, o autor recebe UM aviso.
-- ============================================================================
-- ----------------------------------------------------------------------------
-- Um aviso so, quando o lote acaba com falha. Criada ANTES do veredito que a
-- chama: se o veredito novo existisse sem ela, uma agendada comum que terminasse
-- de sair nesse intervalo daria erro, ficaria em sending e seria REENVIADA pelo
-- resgate de 10 min.
-- ----------------------------------------------------------------------------
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_bulk_send_avisar_se_terminou(p_bulk_send_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_bulk     public.whatsapp_bulk_sends%ROWTYPE;
  v_abertas  int;
  v_falhas   int;
  v_enviadas int;
BEGIN
  IF p_bulk_send_id IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE status IN ('pending','sending')),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status = 'sent')
    INTO v_abertas, v_falhas, v_enviadas
    FROM public.whatsapp_scheduled_messages
   WHERE bulk_send_id = p_bulk_send_id;

  IF v_abertas > 0 OR v_falhas = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_bulk FROM public.whatsapp_bulk_sends WHERE id = p_bulk_send_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  PERFORM public.fn_notify_user(
    v_bulk.tenant_id,
    v_bulk.created_by,
    'scheduled_message_failed',
    'warning',
    'Envio em lote terminou com falhas',
    '"' || v_bulk.titulo || '": ' || v_enviadas || ' enviadas, ' || v_falhas ||
      ' nao saíram depois de 5 tentativas. Abra o envio para ver quais.',
    '/whatsapp/envio-lote?envio=' || v_bulk.id::text,
    jsonb_build_object('bulk_send_id', v_bulk.id, 'falharam', v_falhas, 'enviadas', v_enviadas),
    NULL
  );
END;
$fn$;

-- So o motor chama. Default privileges dariam EXECUTE a authenticated.
REVOKE ALL ON FUNCTION public.fn_bulk_send_avisar_se_terminou(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_bulk_send_avisar_se_terminou(uuid) TO service_role;

COMMIT;

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.fn_claim_due_scheduled_messages(int);

CREATE OR REPLACE FUNCTION public.fn_claim_due_scheduled_messages(
  p_limit          int DEFAULT 25,
  p_antecedencia_s int DEFAULT 0
)
RETURNS SETOF public.whatsapp_scheduled_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_lote_ate timestamptz := now() + make_interval(secs => greatest(0, least(coalesce(p_antecedencia_s, 0), 55)));
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
         -- Lote (DEM-0492): pega ate N s antes; a edge function espera a hora.
         OR (x.status = 'pending' AND x.bulk_send_id IS NOT NULL AND x.scheduled_at <= v_lote_ate)
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

REVOKE ALL ON FUNCTION public.fn_claim_due_scheduled_messages(int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_claim_due_scheduled_messages(int, int) TO service_role;

-- ----------------------------------------------------------------------------
-- Veredito. Igual ao de producao, exceto o aviso no sino para linha de lote.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_finish_scheduled_message(p_id uuid, p_ok boolean, p_message_id uuid DEFAULT NULL::uuid, p_error text DEFAULT NULL::text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_row    public.whatsapp_scheduled_messages%ROWTYPE;
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
    PERFORM public.fn_bulk_send_avisar_se_terminou(v_row.bulk_send_id);
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

  IF v_row.bulk_send_id IS NOT NULL THEN
    PERFORM public.fn_bulk_send_avisar_se_terminou(v_row.bulk_send_id);
    RETURN 'failed';
  END IF;

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

REVOKE ALL ON FUNCTION public.fn_finish_scheduled_message(uuid, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_finish_scheduled_message(uuid, boolean, uuid, text) TO service_role;

COMMIT;
