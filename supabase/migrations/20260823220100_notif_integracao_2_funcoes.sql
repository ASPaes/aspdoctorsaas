-- 23/08/2026 - Fila de integracao parada vira notificacao no sino, e o sino ganha a
-- categoria "integracao" (a terceira aba, so para admin).
--
-- POR QUE EXISTE
-- Linha morta na fila de sincronizacao so aparecia para quem abrisse a aba Fila. A DEM-0237
-- mediu o preco: um upsell de R$ 30 ficou 5 dias parado em 'invalido' sem avisar ninguem.
-- O Omie ganhou alerta em 12/08 ('omie_sync_falhou'), mas (a) in-app ele so chega a quem se
-- inscreveu em Configuracoes > Notificacoes e (b) o clique leva para a ficha do cliente, nao
-- para a linha da fila. O OEM, cuja fila nasceu em 21/08, nao tem alerta nenhum -- e a linha
-- morta some ate da ficha do cliente (fn_oem_pendencias_do_cliente nao lista 'invalido').
--
-- O QUE MUDA
--   1. notification_event_types.categoria aceita 'integracao'. E por ela que o sino monta a
--      terceira aba (Operacao | Sistema | Integracoes): o frontend le a categoria, nao uma
--      lista de chaves no codigo, entao evento novo de integracao cai na aba certa sozinho.
--   2. Todo evento dessa categoria e entregue in-app AOS ADMINS do tenant, sem inscricao.
--      Os admins entram POR CIMA da lista de inscritos, nao no lugar dela: quem ja recebia
--      (in-app ou WhatsApp) continua recebendo exatamente o que recebia.
--   3. O OEM ganha o gatilho de falha que o Omie ja tinha, e os dois ganham um watchdog de
--      fila que nao anda -- inclusive a linha zumbi em 'processando', que o proprio cron nao
--      enxerga (fn_oem_fila_claim marca 'processando' e nao mexe em proxima_tentativa_em; se
--      a edge function morrer no meio, a linha fica invisivel para todo mundo).
--   4. O clique na notificacao abre a fila certa, na linha do erro.
--
-- ATENCAO: AS DUAS FILAS USAM 'erro' COM SENTIDOS OPOSTOS (nao unificar sem ler isto)
--   omie_sync_fila: 'pendente' = vai tentar de novo | 'erro' e 'invalido' = TERMINAL.
--   oem_sync_fila:  'pendente' e 'erro' = vai tentar de novo | 'invalido' = TERMINAL.
--   Por isso o gatilho do OEM dispara so em 'invalido' e o do Omie continua disparando em
--   'erro'+'invalido'. Alertar no 'erro' do OEM seria avisar de algo que se conserta sozinho
--   2 minutos depois.
--
-- NAO MUDA: quiet hours, cooldown, dedupe, e o canal WhatsApp do Omie (fn_omie_wpp_extra
-- continua saindo pela lista de numeros da conta, sem passar por inscricao).
--
-- PARTE 2 - as funcoes (notify_event, Omie, OEM). Nao trava tabela nenhuma.
-- Parte 2 de 4. Rode este arquivo inteiro, sozinho, no SQL Editor.
-- O deadlock de 23/08 aconteceu por rodar tudo de uma vez: ver o cabecalho da parte 1.

BEGIN;

-- ---------------------------------------------------------------------------
-- 3) Quem sao os admins do tenant   [BLOCO 2 - so codigo, nao trava tabela nenhuma]
--    Mesma definicao que o frontend usa (Configuracoes.tsx:297): role = 'admin' OU
--    is_super_admin. Head e user ficam de fora de proposito. "Ativo" pela mesma regra de
--    is_tenant_active_member().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_notif_admins_do_tenant(p_tenant_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT nullif(array_agg(p.user_id), '{}'::uuid[])
    FROM public.profiles p
   WHERE p.tenant_id = p_tenant_id
     AND (p.role = 'admin' OR p.is_super_admin = true)
     AND p.access_status = 'active'
     AND coalesce(p.status, 'ativo') = 'ativo';
$fn$;

REVOKE ALL ON FUNCTION public.fn_notif_admins_do_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_notif_admins_do_tenant(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_notif_admins_do_tenant(uuid) IS
  'Admins ativos do tenant, para entrega automatica dos eventos de categoria integracao. Super admin de OUTRO tenant nao entra: a policy nr_select exige tenant_id = current_tenant_id() e ele nao conseguiria ler a linha.';

-- ---------------------------------------------------------------------------
-- 4) notify_event: entrega automatica para admin quando categoria = 'integracao'
--    Corpo identico ao de producao (conferido no dump de 23/08), com 3 trechos novos
--    marcados [ADMIN]. O caminho [ALVO] (target_user_ids) nao foi tocado.
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

-- ---------------------------------------------------------------------------
-- 5) Omie: o clique passa a abrir a LINHA DA FILA, nao a ficha do cliente.
--    Unica mudanca em relacao ao corpo de producao (dump de 23/08): o p_action_url.
--    O painel da fila do Omie mora dentro da aba Conferencia.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_omie_notificar_falha(p_fila_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f record; v_num text; v_cli text; v_cli_id uuid; v_unidade_id bigint; v_conta_id uuid;
  v_title text; v_body text; v_op text; v_hint text; v_res jsonb;
BEGIN
  SELECT * INTO f FROM public.omie_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT c.numero, c.cliente_id, coalesce(cl.nome_fantasia, cl.razao_social), cl.unidade_base_id
    INTO v_num, v_cli_id, v_cli, v_unidade_id
  FROM public.contratos c LEFT JOIN public.clientes cl ON cl.id = c.cliente_id
  WHERE c.id = f.contrato_id;

  -- Mesma resolucao de conta usada por enfileirar_sync_omie (escopos sao disjuntos por
  -- trg_omie_integration_unidades_disjuntas, entao no maximo 1 conta casa com a unidade).
  v_conta_id := f.conta_integration_id;
  IF v_conta_id IS NULL AND v_unidade_id IS NOT NULL THEN
    SELECT oi.id INTO v_conta_id
    FROM public.omie_integration oi
    WHERE oi.tenant_id = f.tenant_id
      AND (oi.unidades_base_ids IS NULL OR v_unidade_id = ANY(oi.unidades_base_ids))
    LIMIT 1;
  END IF;

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
                       'origem',f.origem,'status',f.status,'erro',f.ultimo_erro,
                       'conta_integration_id',v_conta_id,'unidade_base_id',v_unidade_id,
                       'sistema','omie'),
    -- O destino util e a linha da fila, com o botao de reprocessar e o diagnostico.
    -- Ficha do cliente nao mostra fila nenhuma; era um clique que nao levava a lugar nenhum.
    '/configuracoes?section=integracoes-omie&aba=conferencia&fila=' || f.id::text);

  -- cooldown/evento inativo => nao notificou; a lista configurada tambem nao recebe
  IF coalesce((v_res->>'sent')::boolean, false) THEN
    PERFORM public.fn_omie_wpp_extra((v_res->>'notification_id')::uuid, f.tenant_id, 'omie_sync_falhou', v_title, v_body, v_conta_id);
  END IF;
END; $function$;

-- Ninguem chama isso do frontend (so o gatilho), e um id de fila na mao de qualquer
-- usuario logado e uma notificacao falsa de graca.
REVOKE ALL ON FUNCTION public.fn_omie_notificar_falha(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_omie_notificar_falha(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) OEM: o gatilho de falha que o Omie ja tinha
-- ---------------------------------------------------------------------------

-- A chave de dedupe/resolucao. A linha do modulo e o alvo natural; quando o modulo ainda
-- nao existe na ficha (acao 'ativar'), cai no par produto+codigo do modulo no OEM.
CREATE OR REPLACE FUNCTION public.fn_oem_fila_chave(p_modulo_linha_id uuid, p_cliente_produto_id uuid, p_modulo_codigo integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT coalesce(
    p_modulo_linha_id::text,
    coalesce(p_cliente_produto_id::text, 'sem-produto') || ':' || coalesce(p_modulo_codigo::text, 'sem-modulo')
  );
$fn$;

CREATE OR REPLACE FUNCTION public.fn_oem_notificar_falha(p_fila_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  f record; v_cli text; v_cli_id uuid; v_produto text; v_modulo text;
  v_title text; v_body text; v_op text; v_hint text;
BEGIN
  SELECT * INTO f FROM public.oem_sync_fila WHERE id = p_fila_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Mesmo caminho de join da fn_oem_fila_listar, para a notificacao falar o mesmo nome
  -- que a tela mostra.
  SELECT coalesce(c.nome_fantasia, c.razao_social), c.id, pr.nome
    INTO v_cli, v_cli_id, v_produto
  FROM public.cliente_produtos cp
  LEFT JOIN public.clientes c  ON c.id  = cp.cliente_id
  LEFT JOIN public.produtos  pr ON pr.id = cp.produto_id
  WHERE cp.id = f.cliente_produto_id;

  SELECT pm.nome INTO v_modulo
  FROM public.cliente_produto_modulos cpm
  JOIN public.produto_modulos pm ON pm.id = cpm.modulo_id
  WHERE cpm.id = f.modulo_linha_id;

  v_op := CASE f.acao
    WHEN 'ativar'     THEN 'ativação de módulo'
    WHEN 'quantidade' THEN 'alteração de quantidade'
    WHEN 'cancelar'   THEN 'cancelamento de módulo'
    ELSE coalesce(f.acao, 'alteração')
  END;

  v_hint := CASE
    -- O parceiro ACEITOU e a ficha daqui nao acompanhou. Reprocessar reenviaria a mesma
    -- baixa. Este e o unico caso em que o certo e mexer na ficha na mao.
    WHEN f.ultimo_erro LIKE 'O OEM aceitou%' THEN
      '👉 O que fazer: o OEM já aplicou a alteração na licença, mas a ficha daqui não acompanhou. '
      || 'NÃO reprocesse: isso mandaria o mesmo pedido de novo. Ajuste o módulo na ficha do cliente '
      || 'para bater com a licença e descarte a linha.'
    WHEN f.ultimo_erro LIKE 'Linha sem empresa%' THEN
      '👉 O que fazer: falta cadastro. Confira se o módulo do catálogo tem o código do OEM '
      || '(Configurações → Integrações → OEM → Módulos) e se o produto do cliente está vinculado a uma filial. '
      || 'Depois de preencher, reprocesse a linha.'
    WHEN f.ultimo_erro LIKE 'Nenhuma conta OEM ativa%' THEN
      '👉 O que fazer: não há conta OEM ativa neste tenant, ou a chave sumiu do cofre. '
      || 'Reconecte em Configurações → Integrações → OEM (aba Conexão) e reprocesse a linha.'
    WHEN f.ultimo_erro LIKE '%desistiu após%' THEN
      '👉 O que fazer: o OEM recusou a alteração em todas as tentativas. Leia o motivo acima, '
      || 'corrija o que ele apontou e reprocesse a linha. Simule antes de gravar.'
    ELSE
      '👉 O que fazer: verifique a linha em Configurações → Integrações → OEM (aba Fila). '
      || 'Simule para ver o que seria enviado e reprocesse depois de corrigir a causa.'
  END;

  v_title := 'OEM não sincronizou: ' || coalesce(v_modulo, 'módulo') || ' — ' || coalesce(v_cli, 'cliente');
  v_body  := 'A ' || v_op || ' de ' || coalesce(v_modulo, 'um módulo')
           || coalesce(' no produto ' || v_produto, '')
           || ' não chegou ao OEM e a linha parou na fila.'
           || E'\nMotivo: ' || coalesce(left(f.ultimo_erro, 300), '(sem detalhe)')
           || E'\n\nEnquanto isso, a licença no parceiro está diferente do que a ficha diz aqui.'
           || E'\n\n' || v_hint;

  PERFORM public.notify_event(
    f.tenant_id, 'oem_sync_falhou',
    public.fn_oem_fila_chave(f.modulo_linha_id, f.cliente_produto_id, f.oem_modulo_codigo),
    v_title, v_body,
    jsonb_build_object('fila_id', f.id, 'cliente_id', v_cli_id, 'acao', f.acao,
                       'status', f.status, 'erro', f.ultimo_erro, 'http', f.http,
                       'cliente_produto_id', f.cliente_produto_id,
                       'modulo_linha_id', f.modulo_linha_id,
                       'oem_modulo_codigo', f.oem_modulo_codigo,
                       'sistema', 'oem'),
    '/configuracoes?section=integracoes-oem&aba=fila&fila=' || f.id::text);
END; $function$;

REVOKE ALL ON FUNCTION public.fn_oem_notificar_falha(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_oem_notificar_falha(uuid) TO service_role;

-- O gatilho engole o proprio erro: notificacao que falha nao pode derrubar a gravacao da
-- fila (mesmo desenho do fn_omie_sync_falhou_notify).
CREATE OR REPLACE FUNCTION public.fn_oem_sync_falhou_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.fn_oem_notificar_falha(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_oem_sync_falhou_notify: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_oem_sync_ok_resolve()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM public.resolve_notification_incident(
      NEW.tenant_id, 'oem_sync_falhou',
      public.fn_oem_fila_chave(NEW.modulo_linha_id, NEW.cliente_produto_id, NEW.oem_modulo_codigo));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_oem_sync_ok_resolve: %', SQLERRM;
  END;
  RETURN NEW;
END;
$function$;

COMMIT;
