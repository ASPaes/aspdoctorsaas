-- Entrega confirmada de mensagem WhatsApp.
-- Aditivo: colunas nulas são operação de catálogo, não reescrevem as 510k linhas de
-- whatsapp_messages (que está na publication supabase_realtime — por isso nada aqui
-- escreve em caminho quente; só o ciclo de falha, ~100 linhas/dia).
--
-- O índice parcial que acompanha estas colunas NÃO está aqui: CREATE INDEX CONCURRENTLY
-- não roda em transação e vai por execute_sql, fora do pico. Rodar SEPARADAMENTE:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wa_msg_pendente_verificacao
--     ON public.whatsapp_messages (last_error_at)
--     WHERE status = 'error' AND failure_confirmed_at IS NULL AND delivery_confirmed_at IS NULL;
--
-- Medido no Docker local em 03/08/2026, tabela com 486.213 linhas: build em 994 ms,
-- índice de 32 kB, e a consulta da varredura sai em 0,047 ms por Index Scan.

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS last_error_at          timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_confirmed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS failure_confirmed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS auto_retry_count       smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.whatsapp_messages.last_error_at IS
  'Ultimo ERROR recebido do provedor. Sinal, nao veredito: pode existir em mensagem entregue.';
COMMENT ON COLUMN public.whatsapp_messages.delivery_confirmed_at IS
  'Primeira vez que QUALQUER dispositivo ou participante confirmou recebimento. Prova de que chegou.';
COMMENT ON COLUMN public.whatsapp_messages.failure_confirmed_at IS
  'Quando o verificador confirmou a falha. So ele escreve.';
COMMENT ON COLUMN public.whatsapp_messages.auto_retry_count IS
  'Teto do reenvio automatico. >= 1 nunca dispara nova tentativa automatica.';

-- Janela de confirmacao. Global, uma linha. Nao cabe em configuracoes (e por tenant)
-- nem em cron_estado (guarda execucao de cron, nao configuracao).
-- Fica em banco, e nao em constante, porque nesta base subir edge function redeploya
-- todas as 63: ajustar a janela nao pode exigir deploy.
CREATE TABLE IF NOT EXISTS public.whatsapp_delivery_config (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  confirm_window_seconds smallint NOT NULL DEFAULT 20 CHECK (confirm_window_seconds BETWEEN 5 AND 300),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_delivery_config IS
  'Config global do ciclo de entrega confirmada. Uma linha (id=1).';

INSERT INTO public.whatsapp_delivery_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.whatsapp_delivery_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_delivery_config_sel ON public.whatsapp_delivery_config;
CREATE POLICY wa_delivery_config_sel ON public.whatsapp_delivery_config
  FOR SELECT TO authenticated USING (public.is_super_admin());

DROP POLICY IF EXISTS wa_delivery_config_upd ON public.whatsapp_delivery_config;
CREATE POLICY wa_delivery_config_upd ON public.whatsapp_delivery_config
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

-- Tipo de evento. cooldown_minutes=10 E o agrupamento pedido no desenho: notify_event
-- ja segura repeticao por (tenant, evento, dedupe_key) dentro do cooldown, e conta as
-- ocorrencias em notification_incidents.occurrences. Nenhuma logica nova de agrupamento.
INSERT INTO public.notification_event_types (key, label, descricao, categoria, default_severity, cooldown_minutes, ativo)
VALUES ('whatsapp_message_failed',
        'Mensagem nao entregue',
        'Uma mensagem enviada pelo atendimento nao chegou ao cliente, mesmo apos reenvio automatico.',
        -- categoria tem CHECK: so 'gestao' ou 'sistema'. Mesma do whatsapp_instance_disconnected.
        'sistema', 'warning', 10, true)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label,
      descricao = EXCLUDED.descricao,
      cooldown_minutes = EXCLUDED.cooldown_minutes,
      ativo = true;

-- ---------------------------------------------------------------------------------
-- notify_event: entrega a um alvo explicito quando p_metadata trouxer target_user_ids.
--
-- A ASSINATURA NAO MUDA. Acrescentar um parametro com DEFAULT criaria uma SEGUNDA
-- funcao e todas as chamadas existentes passariam a falhar com "function is not
-- unique" — este projeto ja perdeu motor de producao por acidente de assinatura de RPC.
--
-- Corpo copiado de pg_get_functiondef (md5 bd9a9d06b91ad5a23a984797ac4dcdea, identico
-- em local e producao em 03/08/2026). Duas mudancas, marcadas com [ALVO].
-- ---------------------------------------------------------------------------------
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
  IF v_alvos IS NULL AND NOT EXISTS (SELECT 1 FROM notification_subscriptions s
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
    IF 'whatsapp' = ANY(v_sub.channels) AND v_sub.whatsapp_phone IS NOT NULL THEN
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
