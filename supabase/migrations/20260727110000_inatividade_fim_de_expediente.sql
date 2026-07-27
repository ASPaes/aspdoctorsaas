-- Inatividade que extrapola o expediente: antecipar aviso e encerramento.
--
-- Antes: se o ciclo do cron caía fora do horário comercial, o atendimento era pulado
-- inteiro — sem aviso, sem encerramento e sem nada agendado. O chat atravessava a noite
-- (ou o fim de semana) aberto e o cliente recebia "será encerrado em 5 minutos" na manhã
-- seguinte, sobre uma conversa parada desde o dia anterior.
--
-- Agora: quando o encerramento previsto cai depois do fim do expediente de hoje, o motor
-- antecipa — avisa em (fim − antecedência configurada) e encerra no fim do expediente.
--
-- Escopo: só o motor de inatividade, que por construção só enxerga atendimento com a bola
-- no CLIENTE (awaiting_agent_since IS NULL). Bola com o agente continua com
-- fn_close_attendances_no_agent_response, inalterada.

-- ─── 1. Encerramento agendado ────────────────────────────────────────────────────────
-- Carimbado dentro do expediente, no momento da decisão. É o que torna o encerramento
-- imune ao instante exato do ciclo do cron (*/2): se o ciclo cair 18:01, já fora do
-- expediente, o guard de horário barraria tudo de novo e o fechamento se perderia.
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS inactivity_eod_close_at timestamptz;

COMMENT ON COLUMN public.support_attendances.inactivity_eod_close_at IS
  'Encerramento por inatividade agendado para o fim do expediente, decidido DENTRO do '
  'expediente. Executa mesmo fora do horário. Zerado por fn_reset_inactivity_warning a '
  'qualquer mensagem nova (cliente ou operador).';

-- ─── 2. Configuração por tenant ──────────────────────────────────────────────────────
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_inactivity_eod_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_inactivity_eod_warning_template text NOT NULL
  DEFAULT '⏰ Nosso expediente encerra às {{end}}. Se ainda precisar de ajuda, é só responder — caso contrário este atendimento será encerrado.';

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_inactivity_eod_close_template text NOT NULL
  DEFAULT '✅ Atendimento *{{code}}* encerrado — nosso expediente encerrou às {{end}}.

Se precisar, é só enviar uma nova mensagem que retomamos no próximo dia útil. 😊';

COMMENT ON COLUMN public.configuracoes.support_inactivity_eod_enabled IS
  'Liga a antecipação de aviso/encerramento quando o prazo de inatividade extrapola o '
  'expediente. Desligado = comportamento antigo (o atendimento fica aberto até o próximo dia útil).';

-- ─── 3. Atividade nova cancela o agendamento ─────────────────────────────────────────
-- O trigger já existia para o aviso; passa a cuidar também do encerramento agendado.
-- O par "OLD não é nulo E NEW não mudou" garante que só limpamos quando a atualização é
-- de mensagem, nunca quando é o próprio motor gravando o carimbo.
CREATE OR REPLACE FUNCTION public.fn_reset_inactivity_warning()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_nova_atividade boolean;
BEGIN
  v_nova_atividade := (
    NEW.last_customer_message_at IS DISTINCT FROM OLD.last_customer_message_at
    OR NEW.last_operator_message_at IS DISTINCT FROM OLD.last_operator_message_at
  );

  -- Se houve atividade nova (cliente OU operador) E havia aviso pendente, limpa.
  IF v_nova_atividade
     AND OLD.inactivity_warning_sent_at IS NOT NULL
     AND NEW.inactivity_warning_sent_at IS NOT DISTINCT FROM OLD.inactivity_warning_sent_at
  THEN
    NEW.inactivity_warning_sent_at := NULL;
  END IF;

  -- Mesma atividade cancela o encerramento agendado para o fim do expediente.
  IF v_nova_atividade
     AND OLD.inactivity_eod_close_at IS NOT NULL
     AND NEW.inactivity_eod_close_at IS NOT DISTINCT FROM OLD.inactivity_eod_close_at
  THEN
    NEW.inactivity_eod_close_at := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- ─── 4. Fila do motor ────────────────────────────────────────────────────────────────
-- Passa a devolver três classes de linha:
--   a) vencidos pela regra normal (como antes);
--   b) com encerramento agendado já vencido;
--   c) abertos ainda NÃO vencidos, quando o tenant tem horário comercial + recurso ligados
--      — sem eles não há como antecipar nada.
-- Vencidos vêm primeiro para que a antecipação nunca tire a vez de um encerramento real.
-- Volume medido em prod (27/07/2026): 35 abertos com a bola no cliente, 8 tenants.
DROP FUNCTION IF EXISTS public.get_inactive_attendances_to_process(integer);

CREATE FUNCTION public.get_inactive_attendances_to_process(p_limit integer DEFAULT 200)
 RETURNS TABLE(
   id uuid, attendance_code text, tenant_id uuid, conversation_id uuid, contact_id uuid,
   assigned_to uuid, opened_at timestamptz, last_customer_message_at timestamptz,
   last_operator_message_at timestamptz, inactivity_warning_sent_at timestamptz,
   scheduled_until timestamptz, department_id uuid, instance_id uuid,
   effective_close_min integer, effective_warn_before integer, warn_enabled boolean,
   needs_warn boolean, needs_close boolean,
   inactivity_eod_close_at timestamptz, eod_enabled boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      a.id, a.attendance_code, a.tenant_id, a.conversation_id, a.contact_id, a.assigned_to,
      a.opened_at, a.last_customer_message_at, a.last_operator_message_at,
      a.inactivity_warning_sent_at, a.scheduled_until, a.inactivity_eod_close_at,
      conv.department_id, conv.instance_id,
      GREATEST(
        COALESCE(a.last_customer_message_at, a.opened_at),
        COALESCE(a.last_operator_message_at, a.opened_at),
        a.opened_at
      ) as last_activity
    FROM support_attendances a
    JOIN whatsapp_conversations conv ON conv.id = a.conversation_id
    WHERE a.status = 'in_progress'
      AND a.is_group = false
      AND a.awaiting_agent_since IS NULL
      AND (a.scheduled_until IS NULL OR a.scheduled_until <= now())
      AND COALESCE(a.inactivity_hold, false) = false
  ),
  resolved AS (
    SELECT
      b.*,
      COALESCE(d.auto_close_inactivity_minutes, i.auto_close_inactivity_minutes, c.support_auto_close_inactivity_minutes, 30) as effective_close_min,
      COALESCE(d.inactivity_warning_before_minutes, i.inactivity_warning_before_minutes, c.support_inactivity_warning_before_minutes, 5) as effective_warn_before,
      COALESCE(c.support_send_inactivity_warning, true) as warn_enabled,
      COALESCE(c.support_inactivity_enabled, true) as inactivity_enabled,
      -- antecipação só faz sentido para quem tem expediente configurado
      (COALESCE(c.support_inactivity_eod_enabled, true) AND COALESCE(c.business_hours_enabled, false)) as eod_enabled,
      EXTRACT(EPOCH FROM (now() - b.last_activity)) / 60.0 as elapsed_min,
      CASE
        WHEN b.inactivity_warning_sent_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM (now() - b.inactivity_warning_sent_at)) / 60.0
      END as min_since_warn
    FROM base b
    LEFT JOIN support_departments d ON d.id = b.department_id
    LEFT JOIN whatsapp_instances i ON i.id = b.instance_id
    LEFT JOIN configuracoes c ON c.tenant_id = b.tenant_id
  ),
  flagged AS (
    SELECT
      r.*,
      (r.warn_enabled
       AND r.inactivity_warning_sent_at IS NULL
       AND r.elapsed_min >= GREATEST(0, r.effective_close_min - r.effective_warn_before)
      ) as f_needs_warn,
      (
        (r.warn_enabled AND r.inactivity_warning_sent_at IS NOT NULL
         AND r.min_since_warn >= r.effective_warn_before)
        OR (NOT r.warn_enabled AND r.elapsed_min >= r.effective_close_min)
      ) as f_needs_close,
      (r.inactivity_eod_close_at IS NOT NULL AND r.inactivity_eod_close_at <= now()) as f_eod_due
    FROM resolved r
  )
  SELECT
    f.id, f.attendance_code, f.tenant_id, f.conversation_id, f.contact_id, f.assigned_to,
    f.opened_at, f.last_customer_message_at, f.last_operator_message_at,
    f.inactivity_warning_sent_at, f.scheduled_until,
    f.department_id, f.instance_id,
    f.effective_close_min::int, f.effective_warn_before::int, f.warn_enabled,
    f.f_needs_warn, f.f_needs_close,
    f.inactivity_eod_close_at, f.eod_enabled
  FROM flagged f
  WHERE
    f.inactivity_enabled
    AND (f.f_needs_warn OR f.f_needs_close OR f.f_eod_due OR f.eod_enabled)
  ORDER BY (f.f_needs_warn OR f.f_needs_close OR f.f_eod_due) DESC, f.id ASC
  LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.get_inactive_attendances_to_process(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inactive_attendances_to_process(integer) TO authenticated, service_role;
