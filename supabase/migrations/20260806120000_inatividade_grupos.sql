-- Inatividade do cliente em GRUPOS de WhatsApp
--
-- Hoje a regua "Cliente sem responder" so alcanca 1:1: a fila do motor
-- (get_inactive_attendances_to_process) filtra a.is_group = false. Este
-- arquivo abre a fila para grupo, com configuracao PROPRIA por tenant e
-- DESLIGADA por padrao — nenhum tenant muda de comportamento ao aplicar.
--
-- Escolhas de desenho:
--   1. Espelho completo do bloco 1:1 (ligar, prazo, aviso, antecedencia,
--      texto), mas SEM cascata de setor/instancia. Aqueles overrides existem
--      para roteamento de 1:1; grupo resolve direto no tenant.
--   2. Fim de expediente NAO ganha chave propria: grupo segue
--      support_inactivity_eod_enabled. Expediente e do tenant, nao do canal.
--   3. So grupo em whatsapp_groups.enabled = true entra. Grupo desabilitado
--      nao recebe mensagem inbound (o processor descarta), entao tambem nao
--      deve receber aviso nem mensagem de encerramento.
--
-- ATENCAO: sozinho isto nao encerra nada de forma correta. O atendimento de
-- grupo hoje nunca carimba last_customer_message_at / last_operator_message_at
-- (o message-processor pula toda automacao de grupo), entao a fila mediria a
-- inatividade a partir do opened_at. O carimbo entra na mesma entrega, no
-- message-processor e no send-whatsapp-message.

-- ─── 1. Configuracao por tenant ──────────────────────────────────────────────
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_group_inactivity_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_group_auto_close_inactivity_minutes integer NOT NULL DEFAULT 30;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_group_send_inactivity_warning boolean NOT NULL DEFAULT true;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_group_inactivity_warning_before_minutes integer NOT NULL DEFAULT 5;

ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS support_group_inactivity_warning_template text NOT NULL
  DEFAULT '⚠️ Por falta de interação, este atendimento será encerrado em {{minutes}} minutos. Se ainda precisar de ajuda, responda esta mensagem.';

COMMENT ON COLUMN public.configuracoes.support_group_inactivity_enabled IS
  'Liga a regua de inatividade do cliente para atendimento em GRUPO. Padrao false: '
  'o comportamento historico e grupo nunca encerrar sozinho.';

-- ─── 2. Fila do motor ────────────────────────────────────────────────────────
-- Muda em relacao a versao de 27/07:
--   a) grupo entra (filtro is_group = false vira gate por configuracao);
--   b) os efetivos passam a depender do canal (grupo le as colunas group_*);
--   c) devolve is_group e group_jid — o executor precisa do JID @g.us para
--      enviar; contato de grupo guarda phone_number so com digitos e o
--      buildSendContext montaria @s.whatsapp.net, mandando pro vazio.
DROP FUNCTION IF EXISTS public.get_inactive_attendances_to_process(integer);

CREATE FUNCTION public.get_inactive_attendances_to_process(p_limit integer DEFAULT 200)
 RETURNS TABLE(
   id uuid, attendance_code text, tenant_id uuid, conversation_id uuid, contact_id uuid,
   assigned_to uuid, opened_at timestamptz, last_customer_message_at timestamptz,
   last_operator_message_at timestamptz, inactivity_warning_sent_at timestamptz,
   scheduled_until timestamptz, department_id uuid, instance_id uuid,
   effective_close_min integer, effective_warn_before integer, warn_enabled boolean,
   needs_warn boolean, needs_close boolean,
   inactivity_eod_close_at timestamptz, eod_enabled boolean,
   is_group boolean, group_jid text
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
      COALESCE(a.is_group, false) AS is_group, conv.group_jid,
      GREATEST(
        COALESCE(a.last_customer_message_at, a.opened_at),
        COALESCE(a.last_operator_message_at, a.opened_at),
        a.opened_at
      ) as last_activity
    FROM support_attendances a
    JOIN whatsapp_conversations conv ON conv.id = a.conversation_id
    WHERE a.status = 'in_progress'
      AND a.awaiting_agent_since IS NULL
      AND (a.scheduled_until IS NULL OR a.scheduled_until <= now())
      AND COALESCE(a.inactivity_hold, false) = false
      -- grupo so entra se ainda estiver habilitado na aba Grupos
      AND (
        COALESCE(a.is_group, false) = false
        OR EXISTS (
          SELECT 1 FROM whatsapp_groups g
          WHERE g.tenant_id = a.tenant_id
            AND g.instance_id = conv.instance_id
            AND g.group_jid = conv.group_jid
            AND g.enabled = true
        )
      )
  ),
  resolved AS (
    SELECT
      b.*,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_auto_close_inactivity_minutes, 30)
        ELSE COALESCE(d.auto_close_inactivity_minutes, i.auto_close_inactivity_minutes, c.support_auto_close_inactivity_minutes, 30)
      END as effective_close_min,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_inactivity_warning_before_minutes, 5)
        ELSE COALESCE(d.inactivity_warning_before_minutes, i.inactivity_warning_before_minutes, c.support_inactivity_warning_before_minutes, 5)
      END as effective_warn_before,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_send_inactivity_warning, true)
        ELSE COALESCE(c.support_send_inactivity_warning, true)
      END as warn_enabled,
      CASE WHEN b.is_group
        THEN COALESCE(c.support_group_inactivity_enabled, false)
        ELSE COALESCE(c.support_inactivity_enabled, true)
      END as inactivity_enabled,
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
    f.inactivity_eod_close_at, f.eod_enabled,
    f.is_group, f.group_jid
  FROM flagged f
  WHERE
    f.inactivity_enabled
    AND (f.f_needs_warn OR f.f_needs_close OR f.f_eod_due OR f.eod_enabled)
  ORDER BY (f.f_needs_warn OR f.f_needs_close OR f.f_eod_due) DESC, f.id ASC
  LIMIT p_limit;
$function$;

REVOKE ALL ON FUNCTION public.get_inactive_attendances_to_process(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_inactive_attendances_to_process(integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_inactive_attendances_to_process(integer) IS
  'Fila do motor de inatividade do CLIENTE (bola com o cliente: awaiting_agent_since IS NULL). '
  'Alcanca 1:1 (cascata setor > instancia > tenant) e GRUPO (so tenant, gate '
  'support_group_inactivity_enabled + whatsapp_groups.enabled). Devolve is_group/group_jid '
  'porque o envio a grupo exige o JID @g.us.';
