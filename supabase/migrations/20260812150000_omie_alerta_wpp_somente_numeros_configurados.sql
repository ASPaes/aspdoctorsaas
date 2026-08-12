-- Alertas OMIE no WhatsApp: os numeros configurados em Padroes Omie passam a ser a
-- LISTA UNICA de destinatarios do WhatsApp. Antes eles eram "extras": quem assinava o
-- evento (ex.: admin da unidade) tambem recebia no WhatsApp, sem estar no campo.
--
-- Decisao: o campo `omie_integration.alert_whatsapp_numbers` manda. In-app continua
-- indo para os assinantes normalmente (so o canal WhatsApp muda).
--
-- ATENCAO: o corpo de notify_event aqui parte da versao do repo (20260803193000, com o
-- bloco [ALVO]/target_user_ids da entrega confirmada), NAO do banco local -- o local esta
-- atrasado e copiar dele apagaria aquela feature em producao.
--
-- 3 mudancas:
--   1) flag `whatsapp_extra_only` em notification_event_types (ligada nos 2 eventos OMIE);
--      notify_event para de enfileirar WhatsApp por subscription quando ela esta ligada.
--   2) fn_omie_wpp_extra deixa de pular numero que coincide com telefone de assinante --
--      esse desvio existia so para nao duplicar; sem o envio por subscription, ele
--      passaria a SILENCIAR justamente um numero configurado.
--   3) as duas origens de alerta so chamam fn_omie_wpp_extra quando o notify_event
--      realmente notificou -- antes o cooldown segurava o assinante e nao segurava os
--      numeros configurados, que levavam 1 WhatsApp por tentativa da fila.

BEGIN;

ALTER TABLE public.notification_event_types
  ADD COLUMN IF NOT EXISTS whatsapp_extra_only boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.notification_event_types.whatsapp_extra_only IS
  'true = WhatsApp deste evento sai SOMENTE para a lista de numeros configurada do modulo (ex.: omie_integration.alert_whatsapp_numbers). Assinantes seguem recebendo in-app.';

UPDATE public.notification_event_types
   SET whatsapp_extra_only = true
 WHERE key IN ('omie_sync_falhou', 'omie_vinculo_ambiguo');

-- 1) notify_event: respeita a flag
CREATE OR REPLACE FUNCTION public.notify_event(p_tenant_id uuid, p_event_type text, p_dedupe_key text, p_title text, p_body text, p_metadata jsonb DEFAULT '{}'::jsonb, p_action_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_et record; v_incident_id uuid; v_last_notified timestamptz;
  v_notification_id uuid; v_sub record;
  v_in_app integer := 0; v_wa integer := 0; v_wa_status text;
  v_alvos uuid[];  -- [ALVO]
BEGIN
  SELECT * INTO v_et FROM notification_event_types WHERE key = p_event_type AND ativo;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'unknown_or_inactive_event');
  END IF;

  -- [ALVO] Destinatario explicito: quem escreveu a mensagem precisa saber que ela nao
  -- chegou, esteja ou nao inscrito no evento.
  IF p_metadata ? 'target_user_ids' THEN
    v_alvos := ARRAY(SELECT jsonb_array_elements_text(p_metadata->'target_user_ids')::uuid);
    IF array_length(v_alvos, 1) IS NULL THEN v_alvos := NULL; END IF;
  END IF;

  -- Horário de silêncio (19h–07:30 + fds): segura WhatsApp de TUDO, inclusive critical
  v_wa_status := CASE WHEN public.is_wa_quiet_hours() THEN 'held' ELSE 'pending' END;

  SELECT id, last_notified_at INTO v_incident_id, v_last_notified
  FROM notification_incidents
  WHERE tenant_id = p_tenant_id AND event_type_key = p_event_type
    AND dedupe_key = p_dedupe_key AND resolved_at IS NULL;

  IF FOUND THEN
    UPDATE notification_incidents SET last_seen_at = now(), occurrences = occurrences + 1 WHERE id = v_incident_id;
    IF v_last_notified IS NOT NULL AND v_last_notified > now() - make_interval(mins => v_et.cooldown_minutes) THEN
      RETURN jsonb_build_object('sent', false, 'reason', 'cooldown', 'incident_id', v_incident_id);
    END IF;
  ELSE
    INSERT INTO notification_incidents (tenant_id, event_type_key, dedupe_key)
    VALUES (p_tenant_id, p_event_type, p_dedupe_key) RETURNING id INTO v_incident_id;
  END IF;

  -- [ALVO] So exige inscricao quando NAO ha alvo explicito.
  -- Evento com lista propria de numeros (whatsapp_extra_only) tambem nao depende de
  -- assinante: a notificacao precisa existir para os numeros configurados receberem.
  IF v_alvos IS NULL
     AND NOT coalesce(v_et.whatsapp_extra_only, false)
     AND NOT EXISTS (SELECT 1 FROM notification_subscriptions s
      WHERE s.tenant_id = p_tenant_id AND s.event_type_key = p_event_type AND s.ativo) THEN
    RETURN jsonb_build_object('sent', false, 'reason', 'no_subscribers', 'incident_id', v_incident_id);
  END IF;

  INSERT INTO notifications (tenant_id, type, severity, title, body, action_url, metadata)
  VALUES (p_tenant_id, p_event_type, v_et.default_severity, p_title, p_body, p_action_url,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('incident_id', v_incident_id, 'dedupe_key', p_dedupe_key))
  RETURNING id INTO v_notification_id;

  IF v_alvos IS NOT NULL THEN
    -- [ALVO] Entrega in-app direta. Sem canal WhatsApp de proposito: avisar por WhatsApp
    -- que o WhatsApp falhou e o mesmo desenho circular do watchdog de instancia.
    INSERT INTO notification_recipients (tenant_id, notification_id, user_id, delivered_at)
    SELECT p_tenant_id, v_notification_id, u, now() FROM unnest(v_alvos) AS u WHERE u IS NOT NULL;
    GET DIAGNOSTICS v_in_app = ROW_COUNT;
  ELSE
  FOR v_sub IN
    SELECT s.user_id, s.channels, s.whatsapp_phone FROM notification_subscriptions s
    WHERE s.tenant_id = p_tenant_id AND s.event_type_key = p_event_type AND s.ativo
  LOOP
    IF 'in_app' = ANY(v_sub.channels) THEN
      INSERT INTO notification_recipients (tenant_id, notification_id, user_id, delivered_at)
      VALUES (p_tenant_id, v_notification_id, v_sub.user_id, now());
      v_in_app := v_in_app + 1;
    END IF;
    -- whatsapp_extra_only: o canal WhatsApp deste evento sai so pela lista configurada
    IF NOT coalesce(v_et.whatsapp_extra_only, false)
       AND 'whatsapp' = ANY(v_sub.channels) AND v_sub.whatsapp_phone IS NOT NULL THEN
      IF v_wa_status = 'held' AND EXISTS (
        SELECT 1 FROM notification_whatsapp_outbox ob
        JOIN notifications n2 ON n2.id = ob.notification_id
        WHERE ob.user_id = v_sub.user_id AND ob.status = 'held'
          AND (n2.metadata->>'incident_id') = v_incident_id::text
      ) THEN
        NULL; -- já há alerta segurado deste incidente/usuário: não duplica (evita burst na liberação)
      ELSE
        INSERT INTO notification_whatsapp_outbox (tenant_id, notification_id, user_id, phone, message, status)
        VALUES (p_tenant_id, v_notification_id, v_sub.user_id, v_sub.whatsapp_phone,
                '🔔 *' || p_title || '*' || E'\n\n' || p_body, v_wa_status);
        v_wa := v_wa + 1;
      END IF;
    END IF;
  END LOOP;
  END IF;

  UPDATE notification_incidents SET last_notified_at = now() WHERE id = v_incident_id;
  RETURN jsonb_build_object('sent', true, 'notification_id', v_notification_id, 'incident_id', v_incident_id,
    'in_app', v_in_app, 'whatsapp', v_wa, 'wa_status', v_wa_status);
END $function$;

-- 2) fn_omie_wpp_extra: a lista configurada e a lista final; nada de pular numero
CREATE OR REPLACE FUNCTION public.fn_omie_wpp_extra(p_notification_id uuid, p_tenant_id uuid, p_event_key text, p_title text, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := CASE WHEN public.is_wa_quiet_hours() THEN 'held' ELSE 'pending' END;
  v_msg    text := '🔔 *' || p_title || '*' || E'\n\n' || p_body;
  v_num    text;
BEGIN
  FOR v_num IN
    SELECT DISTINCT regexp_replace(x, '\D', '', 'g')
    FROM public.omie_integration oi
    CROSS JOIN LATERAL unnest(coalesce(oi.alert_whatsapp_numbers, ARRAY[]::text[])) AS x
    WHERE oi.tenant_id = p_tenant_id
  LOOP
    CONTINUE WHEN v_num IS NULL OR length(v_num) < 10;   -- ignora vazio/curto
    -- Sem desvio por subscription: o campo de Padroes Omie manda. Quem estava aqui e
    -- tambem era assinante ficava sem WhatsApp depois que o canal por subscription saiu.
    INSERT INTO public.notification_whatsapp_outbox (tenant_id, notification_id, phone, message, status)
    VALUES (p_tenant_id, p_notification_id, v_num, v_msg, v_status);
  END LOOP;
END;
$function$;

-- 3) origens dos alertas: so aciona a lista quando o evento realmente notificou
CREATE OR REPLACE FUNCTION public.fn_omie_notificar_falha(p_fila_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f record; v_num text; v_cli text; v_cli_id uuid;
  v_title text; v_body text; v_op text; v_hint text; v_res jsonb;
BEGIN
  SELECT * INTO f FROM public.omie_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT c.numero, c.cliente_id, coalesce(cl.nome_fantasia, cl.razao_social)
    INTO v_num, v_cli_id, v_cli
  FROM public.contratos c LEFT JOIN public.clientes cl ON cl.id = c.cliente_id
  WHERE c.id = f.contrato_id;

  -- Antes o ELSE devolvia a origem crua. Com o gatilho aberto, isso viraria
  -- "movimento_cross_sell" na tela e no WhatsApp do cliente interno.
  v_op := CASE f.origem
    WHEN 'churn'                 THEN 'cancelamento'
    WHEN 'reativacao'            THEN 'reativação'
    WHEN 'cadastro'              THEN 'atualização de cadastro'
    WHEN 'observacao'            THEN 'atualização de observação'
    WHEN 'manual'                THEN 'envio manual'
    WHEN 'valor'                 THEN 'alteração de valor'
    WHEN 'reajuste'              THEN 'reajuste'
    WHEN 'movimento_reajuste'    THEN 'reajuste'
    WHEN 'movimento_upsell'      THEN 'upsell'
    WHEN 'movimento_downsell'    THEN 'downsell'
    WHEN 'movimento_cross_sell'  THEN 'venda cruzada'
    ELSE coalesce(f.origem, 'alteração')
  END;

  v_hint := CASE
    WHEN f.ultimo_erro LIKE 'bloqueio:troca_de_produto%' THEN
      '👉 O que fazer: o produto deste contrato mudou no DS e o OMIE continua com a categoria do '
      || 'produto antigo. REPROCESSAR NÃO RESOLVE — a integração ainda não troca produto sozinha. '
      || 'Ajuste o item do contrato direto no OMIE (categoria e código de serviço) e reprocesse. '
      || 'Se as duas categorias forem o mesmo produto na prática, registre a equivalência em '
      || 'Configurações → Integração OMIE.'
    WHEN f.ultimo_erro LIKE 'bloqueio:depara_aponta_cancelado%' THEN
      '👉 O que fazer: o vínculo aponta para um contrato JÁ CANCELADO no OMIE. '
      || CASE WHEN f.origem = 'reativacao'
              THEN 'Reative o contrato direto no OMIE, '
              ELSE 'Cancele/ajuste o contrato certo direto no OMIE, ' END
      || 'OU corrija o vínculo em Configurações → Integração OMIE → Conferência. Depois reprocesse a linha na fila.'
    WHEN f.ultimo_erro LIKE 'bloqueio:produto_sem_mapeamento%' THEN
      '👉 O que fazer: o produto deste contrato não tem categoria mapeada no OMIE. '
      || 'Mapeie o produto em Configurações → Integração OMIE e reprocesse a linha.'
    WHEN f.ultimo_erro LIKE 'bloqueio:%' THEN
      '👉 O que fazer: resolva a pendência do contrato em Configurações → Integração OMIE (Conferência) e reprocesse a linha na fila.'
    WHEN f.ultimo_erro LIKE 'validacao:%' THEN
      '👉 O que fazer: os dados do contrato não passaram na validação. Ajuste o contrato/Padrões OMIE e reprocesse a linha na fila.'
    ELSE
      '👉 O que fazer: verifique a linha em Configurações → Integração OMIE e reprocesse após corrigir a causa.'
  END;

  v_title := 'OMIE não sincronizou: ' || coalesce(v_num,'contrato') || ' — ' || coalesce(v_cli,'cliente');
  -- Frase neutra de genero: serve para "upsell", "reativação" e "venda cruzada" sem concordancia errada.
  v_body  := 'A sincronização do contrato ' || coalesce(v_num, f.contrato_id::text)
           || ' com o OMIE falhou (' || v_op || ') e a fila travou em "' || f.status || '".'
           || E'\nMotivo: ' || coalesce(left(f.ultimo_erro,300),'(sem detalhe)')
           || E'\n\n' || v_hint;

  v_res := public.notify_event(
    f.tenant_id, 'omie_sync_falhou', f.contrato_id::text, v_title, v_body,
    jsonb_build_object('fila_id',f.id,'contrato_id',f.contrato_id,'cliente_id',v_cli_id,
                       'origem',f.origem,'status',f.status,'erro',f.ultimo_erro),
    CASE WHEN v_cli_id IS NOT NULL THEN '/clientes/'||v_cli_id::text ELSE '/clientes' END);

  -- cooldown/evento inativo => nao notificou; a lista configurada tambem nao recebe
  IF coalesce((v_res->>'sent')::boolean, false) THEN
    PERFORM public.fn_omie_wpp_extra((v_res->>'notification_id')::uuid, f.tenant_id, 'omie_sync_falhou', v_title, v_body);
  END IF;
END; $function$;

CREATE OR REPLACE FUNCTION public.fn_omie_alertar_vinculo_ambiguo()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_title text; v_body text; v_res jsonb;
BEGIN
  FOR r IN
    SELECT rc.tenant_id, count(*) AS n
    FROM public.reconciliacao_cadastro rc
    JOIN public.contratos c ON c.id = rc.ds_contract_id
    WHERE rc.estado_match = 'AMBIGUO'
      AND coalesce(rc.status_usuario,'novo') NOT IN ('resolvido','vinculado')
      AND c.status = 'ativo'
    GROUP BY rc.tenant_id
  LOOP
    v_title := r.n || ' contrato(s) com vínculo OMIE ambíguo';
    v_body  := r.n || ' contrato(s) ativo(s) estão com vínculo DS↔OMIE ambíguo, aguardando você escolher o contrato certo na Conferência (Configurações → Integração OMIE). Enquanto não resolver, um cancelamento pode não propagar pro OMIE.';
    v_res := public.notify_event(r.tenant_id, 'omie_vinculo_ambiguo', 'backlog',
                                 v_title, v_body, jsonb_build_object('qtd', r.n), '/configuracoes');
    IF coalesce((v_res->>'sent')::boolean, false) THEN
      PERFORM public.fn_omie_wpp_extra((v_res->>'notification_id')::uuid, r.tenant_id, 'omie_vinculo_ambiguo', v_title, v_body);
    END IF;
  END LOOP;

  FOR r IN
    SELECT i.tenant_id FROM public.notification_incidents i
    WHERE i.event_type_key = 'omie_vinculo_ambiguo' AND i.dedupe_key = 'backlog'
      AND i.resolved_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliacao_cadastro rc
        JOIN public.contratos c ON c.id = rc.ds_contract_id
        WHERE rc.tenant_id = i.tenant_id AND rc.estado_match = 'AMBIGUO'
          AND coalesce(rc.status_usuario,'novo') NOT IN ('resolvido','vinculado')
          AND c.status = 'ativo')
  LOOP
    PERFORM public.resolve_notification_incident(r.tenant_id, 'omie_vinculo_ambiguo', 'backlog');
  END LOOP;
END;
$function$;

COMMIT;
