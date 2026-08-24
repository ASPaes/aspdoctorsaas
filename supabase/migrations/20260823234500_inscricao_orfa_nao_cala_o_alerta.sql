-- 23/08/2026 - Inscricao orfa deixa de calar o alerta de todo mundo.
--
-- O DEFEITO (achado por acidente, testando outra coisa no banco local)
-- `notification_subscriptions` NAO tem chave estrangeira em `user_id`, mas
-- `notification_recipients` TEM, para `profiles(user_id)`, sem ON DELETE. Entao:
--   1. alguem apaga um perfil e a inscricao daquela pessoa fica para tras;
--   2. o proximo notify_event daquele evento tenta inserir o destinatario dela;
--   3. a FK aborta o INSERT -- e, como e um unico INSERT para o laco inteiro, aborta a
--      funcao;
--   4. no caminho dos gatilhos de fila, a excecao e ENGOLIDA por RAISE WARNING (de
--      proposito: notificacao que falha nao pode derrubar a gravacao da fila).
-- Resultado: o alerta para de sair para TODO MUNDO, sem erro em lugar nenhum que alguem
-- olhe. Um perfil apagado meses atras derruba um alarme inteiro, calado.
--
-- Reproduzido no banco local em 23/08: uma inscricao em `omie_sync_falhou` apontando para
-- um usuario sem perfil, e a notificacao do Omie simplesmente nao acontecia enquanto a do
-- OEM acontecia. O WARNING so aparece em log de servidor, que ninguem le.
--
-- O CONSERTO, EM DOIS NIVEIS -- os dois precisam existir:
--   a) a orfa deixa de nascer: FK com ON DELETE CASCADE, para apagar perfil levar junto a
--      inscricao dele (que e o comportamento que qualquer um assumiria que ja existia);
--   b) o notify_event para de ser derrubado por destinatario invalido, venha ele de onde
--      vier -- inclusive de `target_user_ids`, que e passado por quem chama e nao tem FK
--      nenhuma checando antes. So a FK resolveria (a); so o filtro deixaria a orfa viva
--      para sempre.
--
-- Filtrar por perfil nao esconde entrega de ninguem: sem perfil, a policy `nr_select`
-- (`tenant_id = current_tenant_id()`) nunca deixaria a pessoa LER a notificacao. O que se
-- perde e uma linha que ninguem conseguiria abrir.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1) A orfa deixa de nascer   [BLOCO 1 - trava notification_subscriptions]
--    A limpeza vem ANTES da FK: com orfa viva, o ADD CONSTRAINT falha.
--    Sao linhas que ja nao entregam nada hoje -- e cada uma esta calando um evento.
-- ---------------------------------------------------------------------------
DELETE FROM public.notification_subscriptions s
 WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = s.user_id);

ALTER TABLE public.notification_subscriptions
  DROP CONSTRAINT IF EXISTS notification_subscriptions_user_fk;

ALTER TABLE public.notification_subscriptions
  ADD CONSTRAINT notification_subscriptions_user_fk
  FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;

COMMIT;

BEGIN;

-- ---------------------------------------------------------------------------
-- 2) notify_event nao cai mais por destinatario invalido
--    [BLOCO 2 - so codigo]. Corpo igual ao aplicado hoje, com 3 pontos marcados [ORFAO].
-- ---------------------------------------------------------------------------
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
  v_alvos uuid[];            -- [ALVO]
  v_admins uuid[];           -- [ADMIN]
  v_extra integer := 0;      -- [ADMIN]
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

  -- [ADMIN] Problema de integracao e assunto de quem administra o tenant, e nao pode
  -- depender de alguem ter lembrado de se inscrever -- foi assim que uma linha da fila do
  -- Omie ficou 5 dias parada sem dono. Nao substitui o alvo explicito, que e mais especifico.
  IF v_alvos IS NULL AND v_et.categoria = 'integracao' THEN
    v_admins := public.fn_notif_admins_do_tenant(p_tenant_id);
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
  -- [ADMIN] Ter admin ativo no tenant tambem dispensa inscrito.
  IF v_alvos IS NULL
     AND v_admins IS NULL
     AND NOT coalesce(v_et.whatsapp_extra_only, false)
     AND NOT EXISTS (SELECT 1 FROM notification_subscriptions s
      JOIN profiles pp ON pp.user_id = s.user_id
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
    SELECT p_tenant_id, v_notification_id, u, now() FROM unnest(v_alvos) AS u
     WHERE u IS NOT NULL
       -- [ORFAO] id sem perfil nao recebe nada (a policy nr_select exige perfil), mas
       -- a FK notif_recipients_user_fk aborta o INSERT INTEIRO -- e no caminho do
       -- gatilho o erro e engolido por RAISE WARNING. Um destinatario invalido
       -- calava o alerta para TODO MUNDO.
       AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = u);
    GET DIAGNOSTICS v_in_app = ROW_COUNT;
  ELSE
  FOR v_sub IN
    SELECT s.user_id, s.channels, s.whatsapp_phone FROM notification_subscriptions s
    -- [ORFAO] mesma razao: inscricao de quem nao tem mais perfil derrubava a funcao.
    JOIN profiles p ON p.user_id = s.user_id
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

  -- [ADMIN] Depois do laco, e com ON CONFLICT: o admin que TAMBEM e inscrito ja entrou
  -- acima com o canal dele. Aqui ele nao duplica nem perde o WhatsApp que ja tinha.
  IF v_admins IS NOT NULL THEN
    INSERT INTO notification_recipients (tenant_id, notification_id, user_id, delivered_at)
    SELECT p_tenant_id, v_notification_id, u, now() FROM unnest(v_admins) AS u WHERE u IS NOT NULL
    ON CONFLICT (tenant_id, notification_id, user_id) DO NOTHING;
    GET DIAGNOSTICS v_extra = ROW_COUNT;
    v_in_app := v_in_app + v_extra;
  END IF;
  END IF;

  UPDATE notification_incidents SET last_notified_at = now() WHERE id = v_incident_id;
  RETURN jsonb_build_object('sent', true, 'notification_id', v_notification_id, 'incident_id', v_incident_id,
    'in_app', v_in_app, 'whatsapp', v_wa, 'wa_status', v_wa_status, 'admins', v_extra);
END $function$;

COMMIT;

-- Conferencia. Esperado: 0 orfas | 1 (a FK existe) | 1 (o filtro esta no codigo)
SELECT
  (SELECT count(*) FROM public.notification_subscriptions s
    WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = s.user_id)) AS inscricoes_orfas,
  (SELECT count(*) FROM pg_constraint WHERE conname = 'notification_subscriptions_user_fk') AS fk_criada,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'notify_event'
      AND pg_get_functiondef(p.oid) LIKE '%[ORFAO]%') AS notify_event_protegido;
