-- Alertas OMIE no WhatsApp: 2 correcoes em cima da 20260812150000.
--
-- (A) DDI. Os numeros do campo NUNCA funcionaram: saiam como '31996366034' e a Evolution
--     devolvia 400 {"exists":false} nas 3 tentativas. Quem recebia era o telefone do
--     ASSINANTE, gravado '5531996366034' -- o mesmo aparelho, por outro caminho. Agora o
--     numero e normalizado para 55+DDD+numero antes de entrar no outbox.
--
-- (B) Por unidade. A lista era do TENANT: numero cadastrado na conta Omie do DigiUp recebia
--     alerta de contrato de qualquer outra unidade do DigiOffice. Agora o alerta sai pela
--     conta Omie do contrato (omie_sync_fila.conta_integration_id, com fallback pela unidade
--     do cliente) e o digest de vinculo ambiguo passa a ser UM POR CONTA, nao por tenant.
--     Sem conta resolvida, mantem o comportamento antigo (todos os numeros do tenant).

BEGIN;

-- p_conta_id novo => precisa de DROP (CREATE OR REPLACE nao muda assinatura)
DROP FUNCTION IF EXISTS public.fn_omie_wpp_extra(uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.fn_omie_wpp_extra(p_notification_id uuid, p_tenant_id uuid, p_event_key text, p_title text, p_body text, p_conta_id uuid DEFAULT NULL)
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
    SELECT DISTINCT
      -- 55 obrigatorio: sem DDI a Evolution responde exists:false e o alerta morre no outbox
      CASE WHEN length(d) IN (10, 11) THEN '55' || d ELSE d END
    FROM (
      SELECT regexp_replace(x, '\D', '', 'g') AS d
      FROM public.omie_integration oi
      CROSS JOIN LATERAL unnest(coalesce(oi.alert_whatsapp_numbers, ARRAY[]::text[])) AS x
      WHERE oi.tenant_id = p_tenant_id
        -- conta conhecida => so os numeros daquela conta/unidade
        AND (p_conta_id IS NULL OR oi.id = p_conta_id)
    ) s
    WHERE length(d) >= 10   -- ignora vazio/curto
  LOOP
    -- Sem desvio por subscription: o campo de Padroes Omie manda. Quem estava aqui e
    -- tambem era assinante ficava sem WhatsApp depois que o canal por subscription saiu.
    INSERT INTO public.notification_whatsapp_outbox (tenant_id, notification_id, phone, message, status)
    VALUES (p_tenant_id, p_notification_id, v_num, v_msg, v_status);
  END LOOP;
END;
$function$;

-- omie_sync_falhou: alerta vai para a conta Omie do proprio contrato
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
                       'conta_integration_id',v_conta_id,'unidade_base_id',v_unidade_id),
    CASE WHEN v_cli_id IS NOT NULL THEN '/clientes/'||v_cli_id::text ELSE '/clientes' END);

  -- cooldown/evento inativo => nao notificou; a lista configurada tambem nao recebe
  IF coalesce((v_res->>'sent')::boolean, false) THEN
    PERFORM public.fn_omie_wpp_extra((v_res->>'notification_id')::uuid, f.tenant_id, 'omie_sync_falhou', v_title, v_body, v_conta_id);
  END IF;
END; $function$;

-- omie_vinculo_ambiguo: um digest POR CONTA Omie (era um por tenant)
CREATE OR REPLACE FUNCTION public.fn_omie_alertar_vinculo_ambiguo()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_title text; v_body text; v_res jsonb;
  v_key text; v_escopo text; v_vistas text[] := ARRAY[]::text[];
BEGIN
  FOR r IN
    SELECT rc.tenant_id, oi.id AS conta_id, count(*) AS n
    FROM public.reconciliacao_cadastro rc
    JOIN public.contratos c ON c.id = rc.ds_contract_id
    LEFT JOIN public.clientes cl ON cl.id = rc.ds_customer_id
    LEFT JOIN public.omie_integration oi
           ON oi.tenant_id = rc.tenant_id
          AND (oi.unidades_base_ids IS NULL OR cl.unidade_base_id = ANY(oi.unidades_base_ids))
    WHERE rc.estado_match = 'AMBIGUO'
      AND coalesce(rc.status_usuario,'novo') NOT IN ('resolvido','vinculado')
      AND c.status = 'ativo'
    GROUP BY rc.tenant_id, oi.id
  LOOP
    v_key := 'backlog:' || coalesce(r.conta_id::text, 'sem-conta');
    v_vistas := v_vistas || (r.tenant_id::text || '|' || v_key);

    SELECT string_agg(u.nome, ', ' ORDER BY u.nome) INTO v_escopo
    FROM public.omie_integration oi
    CROSS JOIN LATERAL unnest(coalesce(oi.unidades_base_ids, ARRAY[]::bigint[])) AS uid
    JOIN public.unidades_base u ON u.id = uid
    WHERE oi.id = r.conta_id;

    v_title := r.n || ' contrato(s) com vínculo OMIE ambíguo'
               || CASE WHEN v_escopo IS NULL THEN '' ELSE ' — ' || v_escopo END;
    v_body  := r.n || ' contrato(s) ativo(s) estão com vínculo DS↔OMIE ambíguo, aguardando você escolher o contrato certo na Conferência (Configurações → Integração OMIE). Enquanto não resolver, um cancelamento pode não propagar pro OMIE.';
    v_res := public.notify_event(r.tenant_id, 'omie_vinculo_ambiguo', v_key,
                                 v_title, v_body,
                                 jsonb_build_object('qtd', r.n, 'conta_integration_id', r.conta_id),
                                 '/configuracoes');
    IF coalesce((v_res->>'sent')::boolean, false) THEN
      PERFORM public.fn_omie_wpp_extra((v_res->>'notification_id')::uuid, r.tenant_id, 'omie_vinculo_ambiguo', v_title, v_body, r.conta_id);
    END IF;
  END LOOP;

  -- Fecha o que nao apareceu nesta rodada -- inclusive o incidente legado de chave 'backlog',
  -- que ninguem mais reabre depois que a chave virou por conta.
  FOR r IN
    SELECT i.tenant_id, i.dedupe_key FROM public.notification_incidents i
    WHERE i.event_type_key = 'omie_vinculo_ambiguo'
      AND i.resolved_at IS NULL
      AND NOT ((i.tenant_id::text || '|' || i.dedupe_key) = ANY(v_vistas))
  LOOP
    PERFORM public.resolve_notification_incident(r.tenant_id, 'omie_vinculo_ambiguo', r.dedupe_key);
  END LOOP;
END;
$function$;

COMMIT;
