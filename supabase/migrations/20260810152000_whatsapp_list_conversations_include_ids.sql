-- 10/08/2026 -- Conversa recem-aberta voltou a aparecer na barra lateral do chat.
--
-- A excecao de p_include_ids morava no WHERE ("c.last_message_at IS NOT NULL OR
-- c.id = ANY(...)") e era desfeita pelo ORDER BY logo abaixo: sem
-- last_message_at, o NULLS LAST jogava a conversa para o fim das 2.131 do tenant
-- e o LIMIT 50 a cortava. Medido em producao antes do fix: pedindo uma conversa
-- por id em p_include_ids, voltavam 50 linhas e a pedida nao estava em nenhuma.
--
-- Aplicado em producao em 10/08/2026. Esta migration reproduz o corpo FINAL,
-- que e o que esta no banco (md5 do pg_get_functiondef: ebf781197aa1027e4edaddd3d775c398).

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
  -- Entao sao duas pernas. 'pagina' e a de antes, agora com
  -- last_message_at IS NOT NULL como predicado DURO (sem o OR, o indice parcial
  -- volta a ser utilizavel) e com LIMIT/OFFSET recebendo os parametros CRUS.
  -- Isso e deliberado: com "LIMIT (SELECT count(*) ...)" o planner perde a
  -- constante e o custo medido subiu de 5.566 para 8.173 buffers.
  --
  -- 'forcadas' entra pelo unnest do array e cai na PK -- 32 buffers, 0,3ms
  -- medidos, contra 1.745 buffers na forma "c.id = ANY(p_include_ids)", onde o
  -- planner desiste do indice e varre a tabela. Ela so emite linha na PRIMEIRA
  -- pagina; quem casa o deslocamento e o cliente, que conta para o proximo
  -- offset apenas as linhas com last_message_at preenchido (as de 'pagina').
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
  )
  SELECT
    to_jsonb(t.conv) AS conversation,
    to_jsonb(ct)     AS contact,
    t.bucket
  FROM tudo t
  JOIN public.whatsapp_contacts ct ON ct.id = (t.conv).contact_id
  ORDER BY t.ord, (t.conv).last_message_at DESC NULLS LAST;
$function$;
