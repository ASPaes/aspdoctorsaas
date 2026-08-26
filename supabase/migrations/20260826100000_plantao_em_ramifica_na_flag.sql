-- CORREÇÃO da 20260825123000. Dois defeitos vazavam para tenant que NÃO cadastrou
-- janela comercial (horario_comercial_enabled = false):
--
--   C1 — o default de p_tolerancia_min tinha caído de 30 para 5. O trigger
--        trg_zz_set_plantao chama sem passar tolerância, então a régua de 5 min
--        (que só faz sentido numa janela comercial) valia para os 13 tenants.
--   C2 — a troca por fn_instante_fora_comercial jogava fora o p_department_id.
--        fn_janela_comercial_do_dia delega com setor NULL, então o override de
--        support_departments.business_hours sumia. São 10 setores em produção
--        com janela própria (Delvale 5, Digi Office 3, PS Tecnologia 2); na
--        Delvale o efeito era PARA MENOS: plantão que hoje aparece sumiria.
--
-- Correção: a função ramifica na flag do tenant. Com a flag ON usa a janela
-- comercial com tolerância 5; com a flag OFF o corpo é LITERALMENTE o de antes
-- de 25/08/2026 — fn_instante_fora_expediente(tenant, setor, instante, 30).
--
-- O fallback interno de fn_janela_comercial_do_dia continua lá como defesa, mas
-- deixa de ser o caminho que carrega peso: quem decide é o chamador, porque
-- check_tipo_horario precisa de um fallback DIFERENTE deste (slot a slot).
CREATE OR REPLACE FUNCTION public.fn_atendimento_plantao_em(p_tenant_id uuid, p_department_id uuid, p_conversation_id uuid, p_opened_at timestamp with time zone, p_closed_at timestamp with time zone, p_assumed_at timestamp with time zone, p_first_human_at timestamp with time zone, p_tolerancia_min integer DEFAULT 30)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_min   timestamptz;
  v_msg   timestamptz;
  v_fim   timestamptz := COALESCE(p_closed_at, now());
  v_hc_on boolean := false;
BEGIN
  IF p_opened_at IS NULL THEN RETURN NULL; END IF;

  -- Uma leitura só da flag; o CASE abaixo é sobre variável local, não sobre a
  -- tabela. Sem linha em configuracoes o SELECT INTO deixa NULL => false, e o
  -- tenant fica no comportamento antigo (esta função roda dentro do trigger que
  -- fecha atendimento: nada aqui pode levantar exceção).
  SELECT COALESCE(c.horario_comercial_enabled, false) INTO v_hc_on
  FROM public.configuracoes c
  WHERE c.tenant_id = p_tenant_id;
  v_hc_on := COALESCE(v_hc_on, false);

  -- Carimbo só vale se estiver DENTRO da janela do atendimento — mesma régua
  -- da varredura de mensagens logo abaixo.
  IF p_assumed_at IS NOT NULL
     AND p_assumed_at >= p_opened_at AND p_assumed_at <= v_fim
     -- Parênteses obrigatórios: o parser do plpgsql corta a condição do IF no
     -- PRIMEIRO "THEN" fora de parênteses, e o do CASE seria esse.
     AND (CASE WHEN v_hc_on
               THEN public.fn_instante_fora_comercial(p_tenant_id, p_assumed_at, 5)
               ELSE public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_assumed_at, p_tolerancia_min)
          END)
  THEN v_min := p_assumed_at; END IF;

  IF p_first_human_at IS NOT NULL
     AND p_first_human_at >= p_opened_at AND p_first_human_at <= v_fim
     AND (CASE WHEN v_hc_on
               THEN public.fn_instante_fora_comercial(p_tenant_id, p_first_human_at, 5)
               ELSE public.fn_instante_fora_expediente(p_tenant_id, p_department_id, p_first_human_at, p_tolerancia_min)
          END)
  THEN v_min := LEAST(COALESCE(v_min, p_first_human_at), p_first_human_at); END IF;

  IF p_conversation_id IS NOT NULL THEN
    SELECT min(m.timestamp) INTO v_msg
    FROM public.whatsapp_messages m
    WHERE m.conversation_id = p_conversation_id
      AND m.timestamp >= p_opened_at
      AND m.timestamp <= v_fim
      AND m.sent_by_user_id IS NOT NULL
      AND (CASE WHEN v_hc_on
                THEN public.fn_instante_fora_comercial(p_tenant_id, m.timestamp, 5)
                ELSE public.fn_instante_fora_expediente(p_tenant_id, p_department_id, m.timestamp, p_tolerancia_min)
           END);

    IF v_msg IS NOT NULL THEN v_min := LEAST(COALESCE(v_min, v_msg), v_msg); END IF;
  END IF;

  RETURN v_min;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_atendimento_plantao_em(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_atendimento_plantao_em(uuid, uuid, uuid, timestamptz, timestamptz, timestamptz, timestamptz, integer) TO authenticated, service_role;
