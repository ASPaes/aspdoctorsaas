-- DEM-0195 — bloco 3 de 3: quem dispara a saudação.
--
-- ⚠️ Cria trigger em support_attendances (ACCESS EXCLUSIVE por um instante).
-- Aplicar FORA do pico, e só depois dos blocos 1 e 2.
--
-- A REGRA, e por que ela não é a do texto da demanda:
-- a demanda pedia "só na atribuição automática (motor)". Medido em 07/09/2026, a
-- Athuz — quem pediu — está com o motor de distribuição DESLIGADO: 0 atribuições
-- automáticas em 30 dias contra 399 manuais. A regra pedida não dispararia
-- nenhuma vez para ela.
--
-- O que separa os dois casos NA OPERAÇÃO é a ORIGEM do atendimento:
--   cliente chamou   → created_from customer / out_of_hours / billing_automation
--                      (Athuz, 30 dias: 705) → ENVIA quando alguém assume,
--                      seja o motor ou o operador clicando em "Assumir".
--   operador chamou  → created_from agent / operator / ticket (Athuz: 160)
--                      → NÃO envia. Esse caminho já manda "Olá {nome}, o
--                      atendimento X foi iniciado" em send-whatsapp-message.
--   grupo            → nunca envia.
--
-- Decisão do Alexandre em 08/09/2026, com os números acima na mesa.

CREATE OR REPLACE FUNCTION public.fn_enqueue_assignment_greeting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_enabled  boolean;
  v_template text;
BEGIN
  -- Origem do atendimento: é ela que decide, não quem atribuiu.
  IF COALESCE(NEW.created_from, '') NOT IN ('customer', 'out_of_hours', 'billing_automation') THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_group, false) THEN
    RETURN NEW;
  END IF;

  IF NEW.conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Já saudado neste atendimento (transferência, reabertura, trigger de INSERT e
  -- de UPDATE pegando o mesmo evento). A reserva na edge function é o que garante
  -- de verdade; esta checagem só evita a chamada HTTP à toa.
  IF EXISTS (SELECT 1 FROM public.support_attendance_greetings g
              WHERE g.attendance_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(c.support_assignment_greeting_enabled, false),
         c.support_assignment_greeting_template
    INTO v_enabled, v_template
  FROM public.configuracoes c
  WHERE c.tenant_id = NEW.tenant_id;

  IF v_enabled IS DISTINCT FROM true OR COALESCE(btrim(v_template), '') = '' THEN
    RETURN NEW;
  END IF;

  -- pg_net enfileira e devolve na hora: a atribuição não espera o WhatsApp.
  -- Mesmo padrão de fn_onboarding_send_welcome.
  BEGIN
    PERFORM net.http_post(
      url := 'https://vbngjzovjhkmietztffo.supabase.co/functions/v1/send-assignment-greeting',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZibmdqem92amhrbWlldHp0ZmZvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4MDM1MTUsImV4cCI6MjA4NzM3OTUxNX0.A9O36VZMT3x0OlnvjyEUwfa7TwLXkATTqw1dhMpJmGQ'
      ),
      body := jsonb_build_object('attendance_id', NEW.id),
      timeout_milliseconds := 15000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Saudação é efeito colateral: falhar aqui não pode desfazer a atribuição.
    RAISE LOG '[fn_enqueue_assignment_greeting] http_post falhou em att %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.fn_enqueue_assignment_greeting() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_enqueue_assignment_greeting() FROM authenticated;


-- Duas triggers, uma função. TG_OP não pode ser usado em cláusula WHEN, e WHEN é
-- justamente o que mantém o corpo fora do caminho dos ~20 UPDATEs por atendimento
-- (contadores de mensagem, inatividade, denormalização).
DROP TRIGGER IF EXISTS trg_zz_assignment_greeting_ins ON public.support_attendances;
CREATE TRIGGER trg_zz_assignment_greeting_ins
AFTER INSERT ON public.support_attendances
FOR EACH ROW
WHEN (
  NEW.assigned_to IS NOT NULL
  AND NEW.status = 'in_progress'
  AND COALESCE(NEW.is_group, false) = false
)
EXECUTE FUNCTION public.fn_enqueue_assignment_greeting();

-- OLD.status <> 'in_progress' entra no OR porque existe atendimento que fica
-- 'waiting' já com dono (operador responsável do contato) e só depois vira
-- 'in_progress' — sem esse ramo, esse cliente nunca seria saudado.
DROP TRIGGER IF EXISTS trg_zz_assignment_greeting_upd ON public.support_attendances;
CREATE TRIGGER trg_zz_assignment_greeting_upd
AFTER UPDATE OF assigned_to, status ON public.support_attendances
FOR EACH ROW
WHEN (
  NEW.assigned_to IS NOT NULL
  AND NEW.status = 'in_progress'
  AND COALESCE(NEW.is_group, false) = false
  AND (OLD.assigned_to IS NULL OR OLD.status IS DISTINCT FROM 'in_progress')
)
EXECUTE FUNCTION public.fn_enqueue_assignment_greeting();
