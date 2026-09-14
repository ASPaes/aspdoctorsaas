-- ─────────────────────────────────────────────────────────────────────────────
-- Grupo ativo nas configuracoes aparece SEMPRE na aba Grupos do chat.
--
-- APLICADO EM PRODUCAO EM 14/09/2026 via SQL. Este arquivo e o registro do que
-- foi aplicado -- nao a fonte de verdade (ver CLAUDE.md, secao 2).
--
-- Regra do owner: "Caso o grupo esteja ativo nas configuracoes, deve aparecer
-- sempre. Sem excecao."
--
-- O que havia: a lista exige last_message_at IS NOT NULL (predicado DURO, para o
-- indice parcial idx_wa_conv_tenant_lastmsg_active continuar utilizavel) e o
-- trigger fn_ensure_group_conversation, que roda ao habilitar o grupo, so liga
-- group_enabled -- nunca carimba last_message_at. Habilitar um grupo parado nao
-- mudava nada na tela. Medido em 14/09/2026: 38 grupos habilitados invisiveis em
-- 5 tenants (CONSYSA 22, ASP 8, Digi Office 4, Athuz 3, Liberty 1).
--
-- A correcao e de EXIBICAO, nao de dado: carimbar last_message_at inventaria
-- atividade que nao houve no campo que ordena a lista inteira.
--
-- ⚠️ Em producao o indice foi criado com CREATE INDEX CONCURRENTLY (fora de
-- transacao). Aqui vai sem o CONCURRENTLY de proposito: migration roda dentro de
-- transacao e CONCURRENTLY quebraria. O IF NOT EXISTS torna o arquivo inocuo
-- onde o indice ja existe.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_wa_conv_grupos_ativos_sem_msg
ON public.whatsapp_conversations (tenant_id)
WHERE is_group = true AND group_enabled = true AND last_message_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grupo ativo nas configuracoes aparece SEMPRE na aba Grupos, com ou sem
-- mensagem.
--
-- Ate aqui a lista exigia last_message_at IS NOT NULL (predicado DURO, para o
-- indice parcial idx_wa_conv_tenant_lastmsg_active continuar utilizavel), e o
-- trigger fn_ensure_group_conversation nunca carimba last_message_at ao
-- habilitar. Resultado medido em 14/09/2026: 38 grupos habilitados invisiveis
-- em 5 tenants (CONSYSA 22, ASP 8, Digi Office 4, Athuz 3, Liberty 1).
--
-- A correcao e de EXIBICAO, nao de dado: carimbar last_message_at inventaria
-- atividade que nao houve no campo que ordena a lista inteira. A lista ganha
-- uma terceira perna, no molde da que ja existe para p_include_ids.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.whatsapp_list_conversations(p_tenant_id uuid, p_bucket text DEFAULT NULL::text, p_department_id uuid DEFAULT NULL::uuid, p_instance_id uuid DEFAULT NULL::uuid, p_instance_ids uuid[] DEFAULT NULL::uuid[], p_status text DEFAULT NULL::text, p_assigned_to uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT false, p_unread_only boolean DEFAULT false, p_is_group boolean DEFAULT false, p_include_ids uuid[] DEFAULT NULL::uuid[], p_closed_visible_to uuid DEFAULT NULL::uuid, p_auto_reply_disabled_only boolean DEFAULT false, p_rules_disabled_only boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(conversation jsonb, contact jsonb, bucket text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- A pagina e resolvida SO com whatsapp_conversations. O join com
  -- whatsapp_contacts vem depois, sobre as <=50 linhas que sobraram, por PK.
  --
  -- Medido em producao (04/08/2026, tenant ASP, 2.131 conversas): juntar
  -- whatsapp_contacts ANTES do LIMIT dava ao planner a opcao de Merge Join por
  -- contact_id, e para isso ele trocava idx_wa_conv_tenant_lastmsg_active por
  -- idx_wa_conv_tenant_contact. Sem a ordem do indice nao existe parada
  -- antecipada: varria as 1.996 conversas, 7.309 contatos e um top-N heapsort.
  -- 58ms contra 0,73ms da lista atual. CTE MATERIALIZED e o que impede o
  -- planner de achatar tudo de volta num join so.
  --
  -- 10/08/2026 -- CONVERSA RECEM-ABERTA VOLTOU A APARECER NA LISTA.
  -- A excecao de p_include_ids morava no WHERE ("c.last_message_at IS NOT NULL
  -- OR c.id = ANY(...)") e era desfeita pelo ORDER BY logo abaixo: sem
  -- last_message_at, o NULLS LAST jogava a conversa para o fim das 2.131 do
  -- tenant e o LIMIT 50 a cortava. Medido: pedindo uma conversa por id, voltavam
  -- 50 linhas e a pedida nao estava em nenhuma. O operador abria o chat com o
  -- cliente e a conversa sumia da barra lateral em TODAS as pills, so voltando
  -- quando a primeira mensagem gravava last_message_at -- o que parecia "so
  -- aparece depois do F5".
  --
  -- Nao da para consertar no ORDER BY: idx_wa_conv_tenant_lastmsg_active e
  -- PARCIAL (WHERE last_message_at IS NOT NULL). COALESCE ali, ou trocar o
  -- NULLS LAST, tira a lista do caminho do indice -- o defeito de 963ms que ja
  -- custou caro uma vez.
  --
  -- Entao sao TRES pernas. 'pagina' e a de antes, com last_message_at IS NOT
  -- NULL como predicado DURO (sem o OR, o indice parcial volta a ser
  -- utilizavel) e com LIMIT/OFFSET recebendo os parametros CRUS. Isso e
  -- deliberado: com "LIMIT (SELECT count(*) ...)" o planner perde a constante e
  -- o custo medido subiu de 5.566 para 8.173 buffers.
  --
  -- 'forcadas' entra pelo unnest do array e cai na PK -- 32 buffers, 0,3ms
  -- medidos, contra 1.745 buffers na forma "c.id = ANY(p_include_ids)", onde o
  -- planner desiste do indice e varre a tabela. Ela so emite linha na PRIMEIRA
  -- pagina; quem casa o deslocamento e o cliente, que conta para o proximo
  -- offset apenas as linhas com last_message_at preenchido (as de 'pagina').
  --
  -- 14/09/2026 -- 'grupos_ativos' e a terceira. REGRA DO OWNER: grupo ativo nas
  -- configuracoes aparece na aba Grupos SEMPRE, tenha ou nao mensagem. Antes,
  -- habilitar um grupo parado nao mudava nada na tela: fn_ensure_group_conversation
  -- so liga group_enabled, e sem last_message_at a conversa nunca entrava na
  -- 'pagina'. O tenant ASP mostrava 5 dos 13 grupos habilitados.
  -- Ela custa nada fora da aba Grupos (p_is_group IS TRUE vira One-Time Filter
  -- falso) e dentro dela cai em idx_wa_conv_grupos_ativos_sem_msg, indice
  -- parcial de dezenas de linhas. ord = 2 manda esses grupos para o FIM da
  -- lista: sem mensagem, nao competem com grupo ativo pelo topo.
  WITH forcadas AS MATERIALIZED (
    SELECT
      c AS conv,
      public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) AS bucket
    FROM unnest(COALESCE(p_include_ids, ARRAY[]::uuid[])) AS fid(id)
    JOIN public.whatsapp_conversations c ON c.id = fid.id
    LEFT JOIN LATERAL (
      SELECT s.status, s.assigned_to
      FROM public.support_attendances s
      WHERE s.conversation_id = c.id
        AND s.tenant_id       = c.tenant_id
        AND s.status IN ('waiting', 'in_progress')
      ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1
    ) sa ON true
    WHERE c.tenant_id = p_tenant_id
      AND c.last_message_at IS NULL
      AND GREATEST(COALESCE(p_offset, 0), 0) = 0
      AND (p_is_group      IS NULL  OR c.is_group = p_is_group)
      AND (p_is_group      IS NOT TRUE OR c.group_enabled = true)
      AND (p_department_id IS NULL  OR c.department_id = p_department_id OR c.department_id IS NULL)
      AND (p_instance_ids  IS NULL  OR c.instance_id = ANY(p_instance_ids))
      AND (p_instance_id   IS NULL  OR c.instance_id = p_instance_id)
      AND (p_status        IS NULL  OR c.status = p_status)
      AND (
        p_assigned_to    IS NULL
        OR COALESCE(sa.assigned_to, c.assigned_to) = p_assigned_to
        OR c.monitor_user_id = p_assigned_to
        OR (
          public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'closed'
          AND public.wa_last_attendance_owner(c.id, c.tenant_id) = p_assigned_to
        )
      )
      AND (p_unassigned    IS NOT TRUE OR COALESCE(sa.assigned_to, c.assigned_to) IS NULL)
      AND (p_unread_only   IS NOT TRUE OR c.unread_count > 0)
      AND (p_auto_reply_disabled_only IS NOT TRUE OR c.auto_reply_disabled = true)
      AND (p_rules_disabled_only      IS NOT TRUE OR EXISTS (
            SELECT 1 FROM public.whatsapp_contacts ct2
            WHERE ct2.id = c.contact_id AND ct2.rules_disabled = true))
      AND (
        p_bucket IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = p_bucket
      )
      AND (
        p_closed_visible_to IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) <> 'closed'
        OR COALESCE(
             (SELECT s2.assigned_to
              FROM public.support_attendances s2
              WHERE s2.conversation_id = c.id
                AND s2.tenant_id       = c.tenant_id
              ORDER BY s2.opened_at DESC NULLS LAST, s2.created_at DESC
              LIMIT 1),
             p_closed_visible_to
           ) = p_closed_visible_to
      )
  ),
  grupos_ativos AS MATERIALIZED (
    SELECT
      c AS conv,
      public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) AS bucket
    FROM public.whatsapp_conversations c
    LEFT JOIN LATERAL (
      SELECT s.status, s.assigned_to
      FROM public.support_attendances s
      WHERE s.conversation_id = c.id
        AND s.tenant_id       = c.tenant_id
        AND s.status IN ('waiting', 'in_progress')
      ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1
    ) sa ON true
    WHERE p_is_group IS TRUE
      AND c.tenant_id = p_tenant_id
      AND c.is_group = true
      AND c.group_enabled = true
      AND c.last_message_at IS NULL
      AND GREATEST(COALESCE(p_offset, 0), 0) = 0
      -- 'forcadas' ja traz as conversas pedidas por id; sem isto, grupo
      -- habilitado com atendimento ativo sairia duas vezes na mesma pagina.
      AND NOT (c.id = ANY(COALESCE(p_include_ids, ARRAY[]::uuid[])))
      AND (p_department_id IS NULL  OR c.department_id = p_department_id OR c.department_id IS NULL)
      AND (p_instance_ids  IS NULL  OR c.instance_id = ANY(p_instance_ids))
      AND (p_instance_id   IS NULL  OR c.instance_id = p_instance_id)
      AND (p_status        IS NULL  OR c.status = p_status)
      AND (
        p_assigned_to    IS NULL
        OR COALESCE(sa.assigned_to, c.assigned_to) = p_assigned_to
        OR c.monitor_user_id = p_assigned_to
        OR (
          public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'closed'
          AND public.wa_last_attendance_owner(c.id, c.tenant_id) = p_assigned_to
        )
      )
      AND (p_unassigned    IS NOT TRUE OR COALESCE(sa.assigned_to, c.assigned_to) IS NULL)
      AND (p_unread_only   IS NOT TRUE OR c.unread_count > 0)
      AND (p_auto_reply_disabled_only IS NOT TRUE OR c.auto_reply_disabled = true)
      AND (p_rules_disabled_only      IS NOT TRUE OR EXISTS (
            SELECT 1 FROM public.whatsapp_contacts ct2
            WHERE ct2.id = c.contact_id AND ct2.rules_disabled = true))
      AND (
        p_bucket IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = p_bucket
      )
      AND (
        p_closed_visible_to IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) <> 'closed'
        OR COALESCE(
             (SELECT s2.assigned_to
              FROM public.support_attendances s2
              WHERE s2.conversation_id = c.id
                AND s2.tenant_id       = c.tenant_id
              ORDER BY s2.opened_at DESC NULLS LAST, s2.created_at DESC
              LIMIT 1),
             p_closed_visible_to
           ) = p_closed_visible_to
      )
  ),
  pagina AS MATERIALIZED (
    SELECT
      c AS conv,
      public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) AS bucket
    FROM public.whatsapp_conversations c
    LEFT JOIN LATERAL (
      SELECT s.status, s.assigned_to
      FROM public.support_attendances s
      WHERE s.conversation_id = c.id
        AND s.tenant_id       = c.tenant_id
        AND s.status IN ('waiting', 'in_progress')
      ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1
    ) sa ON true
    WHERE c.tenant_id = p_tenant_id
      AND c.last_message_at IS NOT NULL
      AND (p_is_group      IS NULL  OR c.is_group = p_is_group)
      AND (p_is_group      IS NOT TRUE OR c.group_enabled = true)
      AND (p_department_id IS NULL  OR c.department_id = p_department_id OR c.department_id IS NULL)
      AND (p_instance_ids  IS NULL  OR c.instance_id = ANY(p_instance_ids))
      AND (p_instance_id   IS NULL  OR c.instance_id = p_instance_id)
      AND (p_status        IS NULL  OR c.status = p_status)
      -- Filtro de operador. COALESCE, nao OR: e PRECEDENCIA, nao alternativa.
      -- Havendo atendimento ativo, o dono e o DELE -- a mesma fonte que o
      -- cabecalho da tela mostra. c.assigned_to so vale quando o atendimento
      -- ativo esta sem dono ou quando nao ha atendimento ativo.
      AND (
        p_assigned_to    IS NULL
        OR COALESCE(sa.assigned_to, c.assigned_to) = p_assigned_to
        OR c.monitor_user_id = p_assigned_to
        OR (
          public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'closed'
          AND public.wa_last_attendance_owner(c.id, c.tenant_id) = p_assigned_to
        )
      )
      AND (p_unassigned    IS NOT TRUE OR COALESCE(sa.assigned_to, c.assigned_to) IS NULL)
      AND (p_unread_only   IS NOT TRUE OR c.unread_count > 0)
      AND (p_auto_reply_disabled_only IS NOT TRUE OR c.auto_reply_disabled = true)
      AND (p_rules_disabled_only      IS NOT TRUE OR EXISTS (
            SELECT 1 FROM public.whatsapp_contacts ct2
            WHERE ct2.id = c.contact_id AND ct2.rules_disabled = true))
      AND (
        p_bucket IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = p_bucket
      )
      AND (
        p_closed_visible_to IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) <> 'closed'
        OR COALESCE(
             (SELECT s2.assigned_to
              FROM public.support_attendances s2
              WHERE s2.conversation_id = c.id
                AND s2.tenant_id       = c.tenant_id
              ORDER BY s2.opened_at DESC NULLS LAST, s2.created_at DESC
              LIMIT 1),
             p_closed_visible_to
           ) = p_closed_visible_to
      )
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ),
  tudo AS (
    SELECT conv, bucket, 0 AS ord FROM forcadas
    UNION ALL
    SELECT conv, bucket, 1 AS ord FROM pagina
    UNION ALL
    SELECT conv, bucket, 2 AS ord FROM grupos_ativos
  )
  SELECT
    to_jsonb(t.conv) AS conversation,
    to_jsonb(ct)     AS contact,
    t.bucket
  FROM tudo t
  JOIN public.whatsapp_contacts ct ON ct.id = (t.conv).contact_id
  -- ct.name so desempata: em 'forcadas' e 'pagina' o last_message_at ja decide.
  -- Em 'grupos_ativos' ele e TODO o criterio -- grupo parado em ordem alfabetica
  -- e o unico arranjo estavel entre uma carga e outra.
  ORDER BY t.ord, (t.conv).last_message_at DESC NULLS LAST, ct.name;
$function$;

CREATE OR REPLACE FUNCTION public.wa_pill_scope(p_tenant_id uuid, p_department_id uuid DEFAULT NULL::uuid, p_closed_visible_to uuid DEFAULT NULL::uuid, p_assigned_to uuid DEFAULT NULL::uuid, p_unassigned boolean DEFAULT false, p_instance_id uuid DEFAULT NULL::uuid, p_instance_ids uuid[] DEFAULT NULL::uuid[], p_status text DEFAULT NULL::text, p_auto_reply_disabled_only boolean DEFAULT false, p_rules_disabled_only boolean DEFAULT false)
 RETURNS TABLE(conversation_id uuid, unread_count integer, awaiting boolean, pills text[])
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT
      c.id,
      COALESCE(c.unread_count, 0)                     AS unread_count,
      sa.awaiting_agent_since IS NOT NULL             AS awaiting,
      COALESCE(c.is_group, false)                     AS is_group,
      COALESCE(c.group_enabled, false)                AS group_enabled,
      -- Conversa que a lista consegue devolver nas pills que NAO sao Grupos:
      -- tem mensagem, ou tem atendimento ativo (a lista a traz por
      -- p_include_ids). Grupo habilitado sem mensagem entra na base (a pill
      -- Grupos conta) mas nao e "alcancavel" -- ver o CASE de 'all'.
      (c.last_message_at IS NOT NULL OR sa.status IS NOT NULL) AS alcancavel,
      public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) AS bucket,

      -- Um flag por filtro da UI. Cada pill escolhe abaixo quais respeita —
      -- e a escolha e a mesma que ConversationsSidebar faz ao montar os
      -- parametros de whatsapp_list_conversations.
      (p_department_id IS NULL
        OR c.department_id = p_department_id
        OR c.department_id IS NULL)                   AS f_dept,
      -- Escopo da FILA: conversa sem setor pertence aos setores da INSTANCIA
      -- dela, nao a todos. Instancia sem setor nenhum continua caindo para
      -- todos -- e a rede que impede a fila de sumir da tela de todo mundo.
      (p_department_id IS NULL
        OR c.department_id = p_department_id
        OR (c.department_id IS NULL
            AND (c.instance_id = ANY(COALESCE((SELECT public.wa_dept_instance_ids(p_tenant_id, p_department_id)), ARRAY[]::uuid[]))
                 OR NOT (c.instance_id = ANY(COALESCE((SELECT public.wa_instances_with_dept(p_tenant_id)), ARRAY[]::uuid[]))))))
                                                      AS f_dept_fila,
      ((p_instance_ids IS NULL OR c.instance_id = ANY(p_instance_ids))
        AND (p_instance_id IS NULL OR c.instance_id = p_instance_id)) AS f_inst,
      (p_status IS NULL OR c.status = p_status)       AS f_status,
      -- Mesma expressao da lista, byte a byte: dono efetivo (atendimento ativo
      -- tem precedencia sobre a conversa), monitor, e por ultimo o dono do
      -- ultimo atendimento quando a conversa esta encerrada. sa.assigned_to e o
      -- que faz a pill Grupos parar de zerar assim que um operador e escolhido:
      -- em grupo ninguem escreve c.assigned_to.
      (p_assigned_to IS NULL
        OR COALESCE(sa.assigned_to, c.assigned_to) = p_assigned_to
        OR c.monitor_user_id = p_assigned_to
        OR (public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'closed'
            AND public.wa_last_attendance_owner(c.id, c.tenant_id) = p_assigned_to)) AS f_assigned,
      (p_unassigned IS NOT TRUE
        OR COALESCE(sa.assigned_to, c.assigned_to) IS NULL) AS f_unassigned,
      (p_auto_reply_disabled_only IS NOT TRUE OR c.auto_reply_disabled = true) AS f_auto,
      (p_rules_disabled_only IS NOT TRUE OR EXISTS (
         SELECT 1 FROM public.whatsapp_contacts ct
         WHERE ct.id = c.contact_id AND ct.rules_disabled = true)) AS f_rules,
      -- Visibilidade de encerradas para quem nao e admin/head: so as que foram
      -- dele. Subquery escalar de proposito — com p_closed_visible_to NULL o OR
      -- curto-circuita e ela nao chega a ser avaliada.
      (p_closed_visible_to IS NULL
        OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) <> 'closed'
        OR COALESCE(
             (SELECT s2.assigned_to
              FROM public.support_attendances s2
              WHERE s2.conversation_id = c.id
                AND s2.tenant_id       = c.tenant_id
              ORDER BY s2.opened_at DESC NULLS LAST, s2.created_at DESC
              LIMIT 1),
             p_closed_visible_to
           ) = p_closed_visible_to)                   AS f_closed_vis
    FROM public.whatsapp_conversations c
    LEFT JOIN LATERAL (
      -- support_attendances_one_active_per_conversation garante no maximo 1 linha.
      SELECT s.status, s.awaiting_agent_since, s.assigned_to
      FROM public.support_attendances s
      WHERE s.conversation_id = c.id
        AND s.tenant_id       = c.tenant_id
        AND s.status IN ('waiting', 'in_progress')
      ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
      LIMIT 1
    ) sa ON true
    WHERE c.tenant_id = p_tenant_id
      -- Mesma populacao que a lista consegue devolver: conversa sem mensagem e
      -- sem atendimento ativo nao e alcancavel na lista (a lista so a traz por
      -- p_include_ids, que sao justamente os atendimentos ativos). Contar aqui
      -- inflava a pill com linha que ninguem abre.
      --
      -- 14/09/2026 -- GRUPO ATIVO E A EXCECAO. Regra do owner: grupo habilitado
      -- nas configuracoes aparece na aba Grupos sempre, com ou sem mensagem, e a
      -- lista passou a traze-lo pela perna 'grupos_ativos'. Sem esta linha a
      -- pill diria 5 com 13 grupos na tela -- o inverso do DEM-0258.
      AND (c.last_message_at IS NOT NULL
           OR sa.status IS NOT NULL
           OR (COALESCE(c.is_group, false) AND COALESCE(c.group_enabled, false)))
  )
  SELECT b.id, b.unread_count, b.awaiting, x.pills
  FROM base b
  CROSS JOIN LATERAL (
    SELECT ARRAY_REMOVE(ARRAY[
      -- Fila e Fora do horario: sem operador, sem auto-resposta, sem regras.
      CASE WHEN NOT b.is_group AND b.bucket = 'waiting'
                AND b.f_dept_fila AND b.f_inst AND b.f_status
           THEN 'waiting' END,
      CASE WHEN NOT b.is_group AND b.bucket = 'after_hours'
                AND b.f_dept_fila AND b.f_inst AND b.f_status
           THEN 'after_hours' END,
      CASE WHEN NOT b.is_group AND b.bucket = 'in_progress'
                AND b.f_dept AND b.f_inst AND b.f_status
                AND b.f_assigned AND b.f_unassigned AND b.f_auto AND b.f_rules
           THEN 'in_progress' END,
      CASE WHEN NOT b.is_group AND b.bucket = 'closed'
                AND b.f_dept AND b.f_inst AND b.f_status
                AND b.f_assigned AND b.f_unassigned AND b.f_auto AND b.f_rules
                AND b.f_closed_vis
           THEN 'closed' END,
      -- Grupo desativado (group_enabled = false) nao aparece na pill Grupos —
      -- mesma condicao que a lista aplica quando p_is_group = true.
      -- f_dept entrou aqui: grupo agora tem setor. Instancia e status seguem
      -- dispensados, como antes.
      CASE WHEN b.is_group AND b.group_enabled AND b.f_assigned AND b.f_dept
           THEN 'groups' END,
      -- "Todos" inclui grupo porque a lista de "Todos" chama a RPC com
      -- p_is_group = NULL. Por isso 'all' NAO e a soma das outras pills — e a
      -- contagem do que aquela aba mostra, que e o que o usuario confere.
      -- b.alcancavel: a aba "Todos" nao tem a perna 'grupos_ativos' (ela so
      -- roda com p_is_group IS TRUE), entao grupo habilitado sem mensagem
      -- nenhuma continua fora dali -- e fora desta contagem.
      CASE WHEN b.alcancavel
                AND b.f_dept AND b.f_inst AND b.f_status
                AND b.f_assigned AND b.f_unassigned AND b.f_auto AND b.f_rules
                AND b.f_closed_vis
           THEN 'all' END
    ], NULL) AS pills
  ) x
  WHERE cardinality(x.pills) > 0;
$function$;
