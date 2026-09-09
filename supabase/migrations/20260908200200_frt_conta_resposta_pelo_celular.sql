-- Antes: a trigger saía na porta quando sent_by_user_id era NULL, ou seja, só
-- contava como resposta o que saía pela TELA do sistema. Quem responde pelo
-- próprio WhatsApp (em Look Sistemas, 6.013 mensagens contra 4.576 pela tela em
-- 30 dias) nunca carimbava first_human_response_at — e sem ele não há
-- first_response_time_seconds, nem wait_seconds, nem assumed_at. Resultado: TME,
-- 1ª Resposta, TMR e % dentro do SLA mediam 481 de 703 atendimentos.
--
-- A régua nova é POSITIVA: só carimba o que se sabe humano. Painel =
-- sent_by_user_id. Celular = eco fromMe do webhook self-hosted, metadata.source
-- = 'self_hosted' — o mesmo marcador que trg_inactivity_autohold já usa. Nada de
-- listar "o que é robô": automação nova sem flag envenenaria a métrica em
-- silêncio, e é exatamente o que a régua negativa faria. Medido: 18.508
-- mensagens com o marcador em 60 dias, 1 era eco de automação (0,005%).
--
-- assigned_to continua só do painel: o eco do celular não diz QUEM respondeu.
-- Por tabela, o eco também não dispara trg_zz_assignment_greeting_* (a WHEN
-- clause exige assigned_to NOT NULL) — cliente não recebe "olá, vou te
-- atender" depois de já ter sido atendido.
CREATE OR REPLACE FUNCTION public.trg_set_first_human_response()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
DECLARE
  v_att   RECORD;
  v_delta int;
BEGIN
  IF NOT NEW.is_from_me OR NEW.message_type = 'system' THEN
    RETURN NEW;
  END IF;

  -- Humano identificado: pela tela (sent_by_user_id) ou pelo celular
  -- (eco fromMe do webhook self-hosted). Qualquer outra coisa é automação.
  IF NEW.sent_by_user_id IS NULL
     AND COALESCE(NEW.metadata->>'source', '') <> 'self_hosted' THEN
    RETURN NEW;
  END IF;

  SELECT id, opened_at, assigned_to, first_human_response_at, status
  INTO v_att
  FROM support_attendances
  WHERE conversation_id = NEW.conversation_id
    AND tenant_id = NEW.tenant_id
    AND status IN ('waiting', 'in_progress')
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_att.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Relógio do celular pode vir adiantado e produzir delta negativo. Nesse caso
  -- não se inventa tempo de resposta: marca a posse e deixa a métrica de fora.
  v_delta := EXTRACT(EPOCH FROM (NEW.timestamp::timestamptz - v_att.opened_at))::int;

  UPDATE support_attendances
  SET
    first_human_response_at     = CASE WHEN v_delta > 0
                                    THEN COALESCE(first_human_response_at, NEW.timestamp)
                                    ELSE first_human_response_at END,
    first_response_time_seconds = CASE WHEN v_delta > 0
                                    THEN COALESCE(NULLIF(first_response_time_seconds, 0), v_delta)
                                    ELSE first_response_time_seconds END,
    wait_seconds                = CASE WHEN v_delta > 0 AND COALESCE(wait_seconds, 0) = 0
                                    THEN v_delta
                                    ELSE wait_seconds END,
    assigned_to = COALESCE(assigned_to, NEW.sent_by_user_id),
    assumed_at  = COALESCE(assumed_at, NEW.timestamp),
    status      = CASE WHEN status = 'waiting' THEN 'in_progress' ELSE status END,
    updated_at  = now()
  WHERE id = v_att.id;

  IF v_att.assigned_to IS NULL AND NEW.sent_by_user_id IS NOT NULL THEN
    UPDATE whatsapp_conversations
    SET assigned_to = NEW.sent_by_user_id, updated_at = now()
    WHERE id = NEW.conversation_id AND assigned_to IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;
