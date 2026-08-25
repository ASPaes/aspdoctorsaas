-- fn_atendimento_plantao_em passa a medir plantão contra a janela COMERCIAL
-- (fn_instante_fora_comercial), não mais contra a janela de disponibilidade
-- (fn_instante_fora_expediente). Tolerância padrão cai de 30 para 5 minutos.
-- Assinatura inalterada: p_department_id continua na lista de parâmetros
-- (o trigger trg_zz_set_plantao passa NEW.department_id), só deixa de ser usado.
CREATE OR REPLACE FUNCTION public.fn_atendimento_plantao_em(p_tenant_id uuid, p_department_id uuid, p_conversation_id uuid, p_opened_at timestamp with time zone, p_closed_at timestamp with time zone, p_assumed_at timestamp with time zone, p_first_human_at timestamp with time zone, p_tolerancia_min integer DEFAULT 5)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min timestamptz;
  v_msg timestamptz;
  v_fim timestamptz := COALESCE(p_closed_at, now());
BEGIN
  IF p_opened_at IS NULL THEN RETURN NULL; END IF;

  -- Carimbo só vale se estiver DENTRO da janela do atendimento — mesma régua
  -- da varredura de mensagens logo abaixo.
  IF p_assumed_at IS NOT NULL
     AND p_assumed_at >= p_opened_at AND p_assumed_at <= v_fim
     AND public.fn_instante_fora_comercial(p_tenant_id, p_assumed_at, p_tolerancia_min)
  THEN v_min := p_assumed_at; END IF;

  IF p_first_human_at IS NOT NULL
     AND p_first_human_at >= p_opened_at AND p_first_human_at <= v_fim
     AND public.fn_instante_fora_comercial(p_tenant_id, p_first_human_at, p_tolerancia_min)
  THEN v_min := LEAST(COALESCE(v_min, p_first_human_at), p_first_human_at); END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT min(m.timestamp) INTO v_msg
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.timestamp >= p_opened_at
      AND m.timestamp <= v_fim
      AND m.sent_by_user_id IS NOT NULL
      AND public.fn_instante_fora_comercial(p_tenant_id, m.timestamp, p_tolerancia_min);

    IF v_msg IS NOT NULL THEN v_min := LEAST(COALESCE(v_min, v_msg), v_msg); END IF;
  END IF;

  RETURN v_min;
END;
$function$;
