-- DEM-0195 — bloco 2 de 3: o registro de "já mandei" e a reserva atômica.
--
-- Por que uma tabela nova em vez de uma coluna support_attendances.greeting_sent_at:
-- support_attendances tem 27 triggers, 5 deles BEFORE UPDATE sem cláusula WHEN.
-- Um UPDATE só para carimbar "enviei" acordaria todos eles e geraria WAL numa
-- tabela que o Realtime replica. Aqui a reserva é um INSERT ... ON CONFLICT
-- DO NOTHING RETURNING: atômico (duas execuções concorrentes, só uma leva) e
-- sem tocar na tabela quente.

CREATE TABLE IF NOT EXISTS public.support_attendance_greetings (
  attendance_id   uuid PRIMARY KEY REFERENCES public.support_attendances(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL,
  conversation_id uuid,
  claimed_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  status          text NOT NULL DEFAULT 'claimed',
  error           text
);

CREATE INDEX IF NOT EXISTS idx_att_greetings_tenant_claimed
  ON public.support_attendance_greetings (tenant_id, claimed_at DESC);

ALTER TABLE public.support_attendance_greetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_attendance_greetings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_attendance_greetings_tenant_read
  ON public.support_attendance_greetings;

-- Leitura só para auditoria na tela; quem escreve é a edge function (service_role,
-- que ignora RLS). can_access_tenant_row já contempla o super admin.
CREATE POLICY support_attendance_greetings_tenant_read
  ON public.support_attendance_greetings
  FOR SELECT TO authenticated
  USING (public.can_access_tenant_row(tenant_id));


-- Reserva atômica. Devolve true só para a PRIMEIRA chamada de cada atendimento:
-- é isto que impede o cliente de receber a saudação duas vezes quando a trigger
-- de INSERT e a de UPDATE disparam para o mesmo atendimento.
CREATE OR REPLACE FUNCTION public.try_claim_assignment_greeting(p_attendance_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_att   RECORD;
  v_claim uuid;
BEGIN
  IF p_attendance_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, tenant_id, conversation_id, assigned_to, status
    INTO v_att
  FROM public.support_attendances
  WHERE id = p_attendance_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Reconfere na hora do envio: entre a trigger e a edge function o atendimento
  -- pode ter sido encerrado ou devolvido para a fila.
  IF v_att.assigned_to IS NULL OR v_att.status <> 'in_progress' THEN
    RETURN false;
  END IF;

  INSERT INTO public.support_attendance_greetings (attendance_id, tenant_id, conversation_id)
  VALUES (v_att.id, v_att.tenant_id, v_att.conversation_id)
  ON CONFLICT (attendance_id) DO NOTHING
  RETURNING attendance_id INTO v_claim;

  RETURN v_claim IS NOT NULL;
END;
$fn$;

-- REVOKE FROM PUBLIC não basta: default privileges já deram EXECUTE a
-- authenticated. Sem o REVOKE explícito abaixo, qualquer usuário logado
-- conseguiria queimar a reserva e silenciar a saudação de um atendimento.
REVOKE ALL ON FUNCTION public.try_claim_assignment_greeting(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.try_claim_assignment_greeting(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_assignment_greeting(uuid) TO service_role;


-- Fecha o registro depois do envio (ou registra a falha). Mesmo regime de grants.
CREATE OR REPLACE FUNCTION public.mark_assignment_greeting_result(
  p_attendance_id uuid,
  p_status        text,
  p_error         text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  UPDATE public.support_attendance_greetings
     SET status  = COALESCE(p_status, 'sent'),
         sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE sent_at END,
         error   = p_error
   WHERE attendance_id = p_attendance_id;
$fn$;

REVOKE ALL ON FUNCTION public.mark_assignment_greeting_result(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_assignment_greeting_result(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_assignment_greeting_result(uuid, text, text) TO service_role;
