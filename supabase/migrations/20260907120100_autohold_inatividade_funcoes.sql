-- Pausa automática da inatividade (DEM-0353) — Bloco 2 de 3: funções.
-- Nada dispara ainda: o gatilho só entra no bloco 3.

-- ─── 1. Detecção ─────────────────────────────────────────────────────────────
-- Devolve o RÓTULO da família que casou (vira inactivity_hold_reason, que é a
-- auditoria pedida na demanda) ou NULL.
--
-- Os 4 padrões abaixo foram medidos contra 91.036 mensagens reais de operador
-- (30 dias): casam em 4.512 delas, 5,0%. Não é chute de lista de palavras.
--
-- unaccent mora no schema "extensions" neste projeto, e a função fixa
-- search_path='public' — por isso a qualificação explícita. Sem ela o corpo
-- quebra em tempo de execução, não em tempo de CREATE.
CREATE OR REPLACE FUNCTION public.fn_inactivity_autohold_match(
  p_content text,
  p_extra   text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_norm text;
  v_term text;
BEGIN
  IF p_content IS NULL OR btrim(p_content) = '' THEN
    RETURN NULL;
  END IF;

  -- Normaliza uma vez: minúsculo, sem acento, espaços colapsados.
  -- Os padrões abaixo são escritos JÁ sem acento de propósito ("so", "ja").
  v_norm := regexp_replace(lower(extensions.unaccent(p_content)), '\s+', ' ', 'g');

  -- Termos do tenant primeiro: quem configurou manda mais que a lista de fábrica.
  -- position() e não regex — o campo é texto de usuário.
  IF p_extra IS NOT NULL AND btrim(p_extra) <> '' THEN
    FOREACH v_term IN ARRAY string_to_array(p_extra, ',') LOOP
      v_term := btrim(regexp_replace(lower(extensions.unaccent(v_term)), '\s+', ' ', 'g'));
      IF length(v_term) >= 4 AND position(v_term in v_norm) > 0 THEN
        RETURN v_term;
      END IF;
    END LOOP;
  END IF;

  -- aguarde / aguarda / aguardando / aguardar / me aguarde   (1.507 em 30 dias)
  IF v_norm ~ '\yaguard' THEN
    RETURN 'aguarde';
  END IF;

  -- um momento / só um instante / um minutinho / um segundinho  (2.387)
  IF v_norm ~ '\y(um|so um|so)\s*(momento|momentinho|minuto|minutinho|instante|instantinho|segundo|segundinho)\y' THEN
    RETURN 'momento';
  END IF;

  -- já retorno / já te volto / já respondo                        (120)
  IF v_norm ~ '\yja\s*(te\s*)?(retorno|retornamos|volto|respondo|verifico)\y' THEN
    RETURN 'ja_retorno';
  END IF;

  -- vou verificar / estou consultando / tou checando              (841)
  IF v_norm ~ '\y(vou|estou|tou?)\s+(verificar|verificando|checar|checando|analisar|analisando|consultar|consultando)\y' THEN
    RETURN 'verificando';
  END IF;

  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_inactivity_autohold_match(text, text) IS
  'Detecta pedido de paciência do atendente. Devolve o rótulo da família que casou ou NULL.';

-- REVOKE de authenticated explícito: default privileges dão EXECUTE a
-- authenticated em toda função nova, então REVOKE FROM PUBLIC sozinho não
-- restringe nada neste banco.
REVOKE ALL ON FUNCTION public.fn_inactivity_autohold_match(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inactivity_autohold_match(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_inactivity_autohold_match(text, text) TO service_role;

-- ─── 2. Aplicação da pausa ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_inactivity_autohold_on_agent_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg RECORD;
  v_att_id uuid;
  v_term text;
BEGIN
  -- Portão primeiro: com a flag desligada (padrão dos 14 tenants) o gatilho
  -- custa uma leitura indexada em configuracoes, que tem 14 linhas.
  SELECT c.support_inactivity_autohold_enabled AS ligado,
         c.support_inactivity_autohold_minutes AS minutos,
         c.support_inactivity_autohold_extra_terms AS extras
    INTO v_cfg
  FROM public.configuracoes c
  WHERE c.tenant_id = NEW.tenant_id;

  IF NOT FOUND OR v_cfg.ligado IS NOT TRUE OR COALESCE(v_cfg.minutos, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  v_term := public.fn_inactivity_autohold_match(NEW.content, v_cfg.extras);
  IF v_term IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT a.id INTO v_att_id
  FROM public.support_attendances a
  WHERE a.conversation_id = NEW.conversation_id
    AND a.status IN ('waiting','in_progress')
  ORDER BY a.opened_at DESC NULLS LAST, a.created_at DESC
  LIMIT 1;

  IF v_att_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.support_attendances a
     SET inactivity_hold_until =
           GREATEST(COALESCE(a.inactivity_hold_until, now()),
                    now() + make_interval(mins => v_cfg.minutos)),
         inactivity_hold_reason = v_term,
         -- Zera o aviso já enviado. Este é o caso da screenshot da demanda: o
         -- "será encerrado em 5 minutos" já saiu, e o atendente responde
         -- "Um momento" depois. Sem zerar, needs_close dispara 5 min após o
         -- aviso e a pausa não teria servido para nada.
         inactivity_warning_sent_at = NULL,
         -- Idem para o encerramento agendado no fim do expediente: ele é
         -- reavaliado quando a pausa expirar.
         inactivity_eod_close_at = NULL,
         updated_at = now()
   WHERE a.id = v_att_id;

  RETURN NULL;

EXCEPTION WHEN OTHERS THEN
  -- whatsapp_messages é a tabela mais quente do sistema. Pausa que falha nunca
  -- pode derrubar a gravação da mensagem do atendente.
  RAISE LOG '[fn_inactivity_autohold] falhou na mensagem %: %', NEW.id, SQLERRM;
  RETURN NULL;
END;
$function$;

COMMENT ON FUNCTION public.fn_inactivity_autohold_on_agent_message() IS
  'Gatilho AFTER INSERT em whatsapp_messages: suspende a régua de inatividade quando o atendente pede para aguardar.';

-- ─── 3. A fila do motor passa a respeitar a pausa ────────────────────────────
-- Assinatura IDÊNTICA à de produção (lida em 07/09/2026), então é CREATE OR
-- REPLACE puro: sem DROP, sem perder GRANT, sem sobrecarga duplicada.
-- Só duas mudanças, marcadas com [DEM-0353].
--
-- Nenhuma edge function muda. check-inactivity-timeout consome esta RPC e não
-- encosta em _shared — logo isto NÃO redeploya as 66 functions.
CREATE OR REPLACE FUNCTION public.get_inactive_attendances_to_process(p_limit integer DEFAULT 200)
 RETURNS TABLE(id uuid, attendance_code text, tenant_id uuid, conversation_id uuid, contact_id uuid,
   assigned_to uuid, opened_at timestamp with time zone, last_customer_message_at timestamp with time zone,
   last_operator_message_at timestamp with time zone, inactivity_warning_sent_at timestamp with time zone,
   scheduled_until timestamp with time zone, department_id uuid, instance_id uuid,
   effective_close_min integer, effective_warn_before integer, warn_enabled boolean,
   needs_warn boolean, needs_close boolean, inactivity_eod_close_at timestamp with time zone,
   eod_enabled boolean, is_group boolean, group_jid text)
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
        -- [DEM-0353] Pausa vencida RECOMEÇA o relógio. Sem esta linha o
        -- atendimento sai da pausa com o tempo todo já corrido e encerra no
        -- primeiro ciclo seguinte, sem janela para o cliente.
        COALESCE(a.inactivity_hold_until, a.opened_at),
        a.opened_at
      ) as last_activity
    FROM support_attendances a
    JOIN whatsapp_conversations conv ON conv.id = a.conversation_id
    WHERE a.status = 'in_progress'
      AND a.awaiting_agent_since IS NULL
      AND (a.scheduled_until IS NULL OR a.scheduled_until <= now())
      AND COALESCE(a.inactivity_hold, false) = false
      -- [DEM-0353] Pausa ativa: fora da fila. Mesma forma do scheduled_until.
      AND (a.inactivity_hold_until IS NULL OR a.inactivity_hold_until <= now())
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
