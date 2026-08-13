-- "Aguardando você" acendia com a resposta do operador já visível na tela.
--
-- Causa: last_customer_message_at e last_operator_message_at sao carimbados com
-- o instante do PROCESSAMENTO (incrementAttendanceCounter, em
-- supabase/functions/_shared/message-processor.ts, usa new Date()), nao com o
-- timestamp da mensagem. O webhook do cliente chega 1-2s depois do envio do
-- operador, entao numa troca simultanea a ordem de gravacao inverte a ordem
-- real: a tela ordena pelo timestamp da mensagem e mostra o operador por
-- ultimo, o carimbo diz que o cliente falou por ultimo, e awaiting_agent_since
-- acende. Nada limpa ate o operador escrever de novo.
--
-- Medido em 11/08/2026: 681 cruzamentos em 14 dias, 415 conversas, 10 tenants.
-- Caso relatado: atendimento 05074/26 (Digi Office) — carimbo do operador
-- 16:22:19,16 / do cliente 16:22:20,94, sendo que o timestamp da mensagem do
-- cliente e 16:22:19 e o da resposta 16:22:19,12.
--
-- Efeito colateral pior que o badge: get_inactive_attendances_to_process exige
-- awaiting_agent_since IS NULL. Atendimento preso assim sai da regua de
-- inatividade e nao encerra mais sozinho.
--
-- Corrigido AQUI e nao no carimbo de proposito: carimbar o lado do cliente com
-- o relogio do WhatsApp mantendo o operador no relogio do servidor misturaria
-- dois relogios — celular adiantado gravaria awaiting no futuro e a resposta do
-- operador nunca limparia. A guarda decide pelo mesmo relogio da TELA
-- (whatsapp_messages.timestamp), entao o badge nunca contradiz o que se ve.
-- Bonus: nao encosta em _shared, logo nao redeploya as 65 edge functions.
--
-- Reacao nao conta como resposta (emoji nao responde pergunta) nem como
-- pergunta. Empate no mesmo segundo conta como respondido (>=): timestamp de
-- entrada vem do WhatsApp com granularidade de segundo, e falso alerta custa
-- mais que alerta 1s atrasado.
--
-- SECURITY DEFINER porque a guarda le whatsapp_messages: sem isso o resultado
-- dependeria da RLS de quem disparou o UPDATE.
--
-- Aplicada em producao em 11/08/2026 junto com a limpeza do residuo (5
-- atendimentos abertos com o alerta aceso e a resposta do operador na tela).
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
    RETURN NEW;
  END IF;

  -- Agente respondeu (operador alcança o cliente): limpa
  IF NEW.last_operator_message_at IS DISTINCT FROM OLD.last_operator_message_at
     AND NEW.last_operator_message_at IS NOT NULL
     AND (NEW.last_customer_message_at IS NULL
          OR NEW.last_operator_message_at >= NEW.last_customer_message_at) THEN
    NEW.awaiting_agent_since := NULL;
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

-- Limpeza do residuo aplicada junto (registro do que rodou; nao re-executar as
-- cegas). Regra identica a da guarda, de proposito: quem ainda tem so reacao do
-- operador, ou resposta anterior a ultima fala do cliente, continua aceso.
--
-- UPDATE public.support_attendances sa
--    SET awaiting_agent_since = NULL, updated_at = now()
--  WHERE sa.status IN ('waiting','in_progress')
--    AND sa.awaiting_agent_since IS NOT NULL
--    AND EXISTS (
--      SELECT 1 FROM public.whatsapp_messages m
--      WHERE m.conversation_id = sa.conversation_id AND m.is_from_me
--        AND m.deleted_at IS NULL
--        AND COALESCE(m.message_type,'') NOT IN ('system','reaction')
--        AND m.timestamp >= (SELECT max(m2.timestamp) FROM public.whatsapp_messages m2
--                            WHERE m2.conversation_id = sa.conversation_id AND NOT m2.is_from_me
--                              AND m2.deleted_at IS NULL
--                              AND COALESCE(m2.message_type,'') NOT IN ('system','reaction')));
