-- Notificacao de chat vazando para o tenant inteiro (23/08/2026)
--
-- Queixa: "o aviso do grupo vinculado ao Suporte Gula chega para todo mundo, e
-- o chat que o Jose esta atendendo tambem". Ja tinha sido tratado em 13/08 e
-- voltou -- porque o tratamento de 13/08 foi que introduziu o pior dos casos.
--
-- Sao TRES defeitos na mesma funcao. Os dois primeiros sao de codigo e nao
-- dependem de dado nenhum para reproduzir.
--
-- (1) REGRESSAO DE 13/08 -- o degrau do dono nao termina com RETURN.
--     20260813121000 tirou o ultimo degrau (tenant inteiro) de dentro de um ELSE
--     e o promoveu a caminho de saida comum, acrescentando RETURN nos degraus de
--     setor e de fallback. O degrau do dono ficou sem. Ele nunca tinha precisado:
--     enquanto o tenant morava no ELSE, sair do IF ja bastava.
--
--       IF v_assigned_to IS NOT NULL THEN
--         -- "Chat com dono: so ele" (comentario da propria funcao)
--         RETURN QUERY SELECT v_assigned_to, false;   <-- sem RETURN
--       ELSIF ...
--       END IF;
--       -- ultimo degrau: tenant inteiro                <-- executa em seguida
--
--     Resultado: TODA conversa com dono notifica o dono E o tenant inteiro, em
--     silent_mode = false (som + toast). E o caso mais comum do sistema, e
--     explica a reclamacao melhor que qualquer questao de dado.
--
-- (2) O dono lido e whatsapp_conversations.assigned_to, e em GRUPO ele e sempre
--     NULL: trg_enforce_group_rules faz "NEW.assigned_to := NULL" em todo INSERT
--     e UPDATE de conversa de grupo. Entao grupo atendido pelo Jose nunca entra
--     no degrau do dono. Passa a valer COALESCE(dono do atendimento ativo, dono
--     da conversa) -- o mesmo COALESCE que 20260810120000 ja aplicou em
--     whatsapp_list_conversations e wa_pill_scope, e a mesma fonte que o
--     cabecalho do chat mostra na tela.
--     O setor tambem passa a ter fallback em whatsapp_groups.department_id, para
--     o caso do espelho de trg_zz_group_department nao ter rodado.
--
-- (3) Grupo sem setor cai direto no tenant inteiro. Medido em producao em
--     23/08/2026: 60 grupos ativos sem setor (Athuz 31 de 31, CONSYSA 16 de 16,
--     ASP 11 de 12, Liberty 2 de 2, Digi Office 3 de 47). O degrau de fallback
--     que deveria pegar esses casos existe em 1 dos 13 tenants -- na pratica
--     nunca roda.
--     Entra um degrau novo ANTES do tenant: os setores ligados a INSTANCIA da
--     conversa (support_department_instances). A instancia de WhatsApp ja e
--     dividida por setor, entao esse conjunto e sempre mais estreito que o
--     tenant e nunca e vazio quando a instancia esta configurada.
--
-- POR QUE ISTO NAO DEIXA NINGUEM MUDO: o degrau do tenant continua existindo
-- como ultimo recurso, para instancia sem setor configurado. A mudanca so
-- ESTREITA o conjunto quando ha informacao para estreitar -- nenhuma conversa
-- passa a ter zero destinatario que hoje tem algum.
--
-- MUDANCA DE COMPORTAMENTO A DECLARAR: com o RETURN no degrau do dono, a ETAPA 2
-- (monitores admin/head, silent_mode = true) deixa de rodar para chat que ja tem
-- dono. Hoje ela roda ali por acidente -- justamente por causa do RETURN que
-- falta. Passa a ser igual ao degrau de setor, que ja termina com RETURN desde
-- 13/08 sem que ninguem tenha reclamado de perder o monitor.
--
-- Estrutura: os tres degraus de "membros de setor" (setor da conversa, fallback,
-- setores da instancia) so diferem no conjunto de department_ids. Viraram uma
-- escolha de v_dept_ids seguida de UM bloco de emissao, em vez das tres copias
-- quase identicas de antes. A regra de escopo e a guarda de 13/08 continuam
-- iguais, agora escritas uma vez so.
--
-- DISTINCT no bloco de emissao e novo e obrigatorio: o degrau da instancia pode
-- trazer varios setores, e um usuario em dois deles sairia duplicado.
--
-- Mesma assinatura -> CREATE OR REPLACE basta, sem DROP e sem mexer em
-- process_notification_dispatch_queue, que e quem chama.

CREATE OR REPLACE FUNCTION public.get_message_notification_recipients_v2(p_conversation_id uuid)
 RETURNS TABLE(user_id uuid, silent_mode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id        uuid;
  v_assigned_to      uuid;
  v_department_id    uuid;
  v_instance_id      uuid;
  v_fallback_dept_id uuid;
  v_dept_ids         uuid[];
  v_scoped           int;
BEGIN
  -- Dono efetivo e setor efetivo, na mesma leitura.
  --
  -- support_attendances_one_active_per_conversation garante no maximo 1 linha no
  -- LATERAL. O join com whatsapp_groups so casa em conversa de grupo (o
  -- predicado conv.is_group IS TRUE esta na condicao do join) e cai no indice
  -- unico uq_whatsapp_groups_tenant_instance_jid.
  SELECT conv.tenant_id,
         COALESCE(sa.assigned_to, conv.assigned_to),
         COALESCE(conv.department_id, g.department_id),
         conv.instance_id
    INTO v_tenant_id, v_assigned_to, v_department_id, v_instance_id
  FROM public.whatsapp_conversations conv
  LEFT JOIN LATERAL (
    SELECT s.assigned_to
    FROM public.support_attendances s
    WHERE s.conversation_id = conv.id
      AND s.tenant_id       = conv.tenant_id
      AND s.status IN ('waiting', 'in_progress')
    ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ) sa ON true
  LEFT JOIN public.whatsapp_groups g
         ON conv.is_group IS TRUE
        AND g.tenant_id   = conv.tenant_id
        AND g.instance_id = conv.instance_id
        AND g.group_jid   = conv.group_jid
  WHERE conv.id = p_conversation_id;

  IF v_tenant_id IS NULL THEN RETURN; END IF;

  -- ETAPA 1: destinatarios OPERACIONAIS (silent_mode = false)

  -- Degrau 1: chat com dono e so do dono. Escopo nao entra aqui -- o proprio
  -- chat nunca e silenciado por preferencia de fila. O RETURN e o que faltava.
  IF v_assigned_to IS NOT NULL THEN
    RETURN QUERY SELECT v_assigned_to, false;
    RETURN;
  END IF;

  -- Sem dono: escolhe QUAL conjunto de setores responde por esta conversa.
  -- Primeiro que tiver membro ativo vence; os seguintes nem sao consultados.
  IF v_department_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.support_department_members
                  WHERE department_id = v_department_id AND is_active = true) THEN
    v_dept_ids := ARRAY[v_department_id];
  ELSE
    SELECT id INTO v_fallback_dept_id
    FROM public.support_departments
    WHERE tenant_id = v_tenant_id AND is_default_fallback = true AND is_active = true
    LIMIT 1;

    IF v_fallback_dept_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.support_department_members
                    WHERE department_id = v_fallback_dept_id AND is_active = true) THEN
      v_dept_ids := ARRAY[v_fallback_dept_id];
    ELSE
      -- Degrau novo: setores da instancia. So entram os que tem membro ativo,
      -- para o bloco de emissao abaixo nunca sair vazio por causa deles.
      SELECT array_agg(DISTINCT sdi.department_id) INTO v_dept_ids
      FROM public.support_department_instances sdi
      WHERE sdi.tenant_id   = v_tenant_id
        AND sdi.instance_id = v_instance_id
        AND sdi.is_active   = true
        AND EXISTS (SELECT 1 FROM public.support_department_members sdm
                     WHERE sdm.department_id = sdi.department_id AND sdm.is_active = true);
    END IF;
  END IF;

  -- Degraus 2 a 4: membros dos setores escolhidos.
  --
  -- A guarda de 13/08 continua valendo e continua sendo POR DEGRAU: se o filtro
  -- de notification_scope deixaria este degrau vazio, o filtro e ignorado. Sao
  -- 16 setores compostos so de admin/head, que ficariam sem destinatario nenhum.
  IF v_dept_ids IS NOT NULL AND cardinality(v_dept_ids) > 0 THEN
    SELECT COUNT(*) INTO v_scoped
    FROM public.support_department_members sdm
    JOIN public.profiles p ON p.user_id = sdm.user_id
    LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
    WHERE sdm.department_id = ANY(v_dept_ids) AND sdm.is_active = true
      AND COALESCE(up.notification_scope,
            CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

    RETURN QUERY
    SELECT DISTINCT sdm.user_id, false
    FROM public.support_department_members sdm
    JOIN public.profiles p ON p.user_id = sdm.user_id
    LEFT JOIN public.user_preferences up ON up.user_id = sdm.user_id
    WHERE sdm.department_id = ANY(v_dept_ids) AND sdm.is_active = true
      AND (v_scoped = 0
           OR COALESCE(up.notification_scope,
                CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');
    RETURN;
  END IF;

  -- Ultimo degrau: tenant inteiro. Rede de seguranca para instancia sem nenhum
  -- setor configurado -- alguem tem que ver a mensagem. Com o degrau da
  -- instancia acima, ele passa a ser raro em vez de ser o caminho comum.
  SELECT COUNT(*) INTO v_scoped
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('user','head','admin') AND p.access_status = 'active'
    AND COALESCE(up.notification_scope,
          CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only';

  RETURN QUERY
  SELECT p.user_id, false
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('user','head','admin') AND p.access_status = 'active'
    AND (v_scoped = 0
         OR COALESCE(up.notification_scope,
              CASE WHEN p.role IN ('admin','head') THEN 'mine_only' ELSE 'all' END) <> 'mine_only');

  -- ETAPA 2: MONITORES (silent_mode = true). Regra inalterada; so o NOT IN passa
  -- a usar v_dept_ids, que aqui e sempre vazio (se nao fosse, o degrau acima
  -- teria retornado). Mantido explicito para a exclusao continuar correta caso
  -- outro degrau volte a cair neste ponto.
  RETURN QUERY
  SELECT p.user_id, true
  FROM public.profiles p
  LEFT JOIN public.user_preferences up ON up.user_id = p.user_id
  WHERE p.tenant_id = v_tenant_id
    AND p.role IN ('admin','head') AND p.access_status = 'active'
    AND p.user_id NOT IN (
      SELECT u FROM (
        SELECT v_assigned_to AS u WHERE v_assigned_to IS NOT NULL
        UNION
        SELECT sdm.user_id FROM public.support_department_members sdm
         WHERE sdm.department_id = ANY(COALESCE(v_dept_ids, ARRAY[]::uuid[]))
           AND sdm.is_active = true
      ) sub
    )
    AND (
      COALESCE(up.notification_scope, 'all') = 'all'
      OR (COALESCE(up.notification_scope, 'all') = 'my_departments'
          AND v_department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.support_department_members sdm2
            WHERE sdm2.user_id = p.user_id AND sdm2.department_id = v_department_id
              AND sdm2.is_active = true))
      OR (COALESCE(up.notification_scope, 'all') = 'mine_only' AND v_assigned_to = p.user_id)
    );
END;
$function$;

COMMENT ON FUNCTION public.get_message_notification_recipients_v2(uuid) IS
  'Quem recebe aviso de mensagem nova. Degraus: dono efetivo (COALESCE do dono do '
  'atendimento ativo com o da conversa, porque grupo tem assigned_to zerado por '
  'trg_enforce_group_rules) -> setor da conversa -> fallback do tenant -> setores '
  'da instancia -> tenant inteiro. Cada degrau ENCERRA a etapa operacional. O '
  'RETURN do degrau do dono e o que faltava desde 20260813121000: sem ele, todo '
  'chat com dono notificava o dono E o tenant inteiro.';
