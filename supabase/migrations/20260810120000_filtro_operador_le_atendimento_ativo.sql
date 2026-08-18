-- Filtro "Operador" nao achava conversa EM ATENDIMENTO do proprio operador
--
-- Reportado na Digi Office: o chat mostra "Atribuida - Fabianne" no cabecalho,
-- mas filtrando por Fabianne ele some da lista (e da contagem da pill).
--
-- Causa: tela e filtro leem colunas diferentes.
--   Cabecalho (ChatHeader)  -> support_attendances.assigned_to  (atendimento ativo)
--   Filtro   (esta funcao)  -> whatsapp_conversations.assigned_to
-- 20260807150000 ja tinha corrigido metade disso, mas SO para o bucket 'closed'
-- (via wa_last_attendance_owner). Conversa viva continuou comparando so a coluna
-- da conversa.
--
-- As duas divergem de forma PERMANENTE em caminhos que existem hoje:
--   - start_conversation_from_ticket: na conversa ja existente faz
--     assigned_to = COALESCE(assigned_to, v_uid) — mantem o dono antigo — mas o
--     atendimento novo nasce com v_uid. E o fluxo de onboarding por ticket da
--     Digi Office.
--   - trg_set_first_human_response: so espelha na conversa quando o atendimento
--     estava SEM dono. Se ja tinha, nunca mais corrige.
--   - send-whatsapp-message: so espelha na transicao waiting -> in_progress.
--     Atendimento ja in_progress nao escreve nada na conversa.
--   - GRUPO: start_group_attendance nao toca em whatsapp_conversations e a edge
--     function pula o espelhamento para grupo (`!isGroupConv`). Ou seja, TODO
--     grupo em atendimento sumia do filtro de operador — e a pill Grupos zerava
--     junto, porque ela tambem respeita f_assigned.
--
-- Fix: o dono passa a ser COALESCE(atendimento ativo, conversa) — exatamente o
-- que o cabecalho mostra. O LEFT JOIN LATERAL do atendimento ativo ja existe nas
-- duas funcoes, so faltava trazer a coluna. Custo de plano zero: nenhuma
-- subconsulta nova, nenhum indice novo.
--
-- COALESCE e nao OR: com OR, a conversa cujo c.assigned_to aponta para OUTRO
-- operador apareceria para os dois. Medido em producao em 10/08/2026 na Digi
-- Office: das 5 conversas divergentes, 4 tinham c.assigned_to NULL e 1 apontava
-- para um operador que nao era o do atendimento.
--
-- Nao mexe nos dados: espelhar assigned_to em whatsapp_conversations por backfill
-- seria UPDATE em tabela que esta na publication supabase_realtime (WAL + fanout
-- por linha) para resolver o que uma comparacao resolve de graca.
--
-- Espelho do mesmo defeito, corrigido junto: "Na Fila (sem operador)"
-- (p_unassigned) olhava so c.assigned_to — a mesma conversa acima, com dono no
-- atendimento e NULL na conversa, aparecia como se estivesse sem operador.
--
-- As DUAS funcoes mudam no mesmo commit: lista e contagem tem que sair da mesma
-- expressao, senao volta a divergir como no DEM-0234.
--
-- Mesma aridade nas duas -> CREATE OR REPLACE basta, sem DROP.

-- ---------------------------------------------------------------------------
-- REGENERADO EM 18/08/2026 A PARTIR DO DUMP DE PRODUCAO. Leia antes de rodar.
--
-- Este arquivo ficou solto na arvore, sem commit, desde 10/08. Ao versiona-lo
-- descobriu-se que o corpo que ele carregava estava ATRAS da producao, e que
-- roda-lo teria causado REGRESSAO -- migration desatualizada no repo e pior que
-- migration ausente, porque na hora de recuperar alguem roda.
--
-- O que faltava: a whatsapp_list_conversations recebeu, DEPOIS deste arquivo,
-- a CTE `forcadas`, que resolve p_include_ids por unnest + PK. A versao antiga
-- resolvia com "OR c.id = ANY(COALESCE(p_include_ids, ...))" dentro do WHERE, e
-- isso tinha dois defeitos que o comentario da propria funcao documenta:
--   - o ORDER BY ... NULLS LAST + LIMIT 50 desfazia a excecao, e a conversa
--     recem-aberta sumia da barra lateral em TODAS as pills ate gravar a
--     primeira mensagem (parecia "so aparece depois do F5");
--   - 1.745 buffers nessa forma contra 32 na atual.
-- O wa_pill_scope, a outra funcao do arquivo, ja batia com producao.
--
-- A correcao de filtro de operador descrita no cabecalho acima -- o
-- COALESCE(sa.assigned_to, c.assigned_to) -- continua presente nas duas, e e o
-- que este arquivo registra. Os corpos abaixo sao os de PRODUCAO, copiados do
-- dump e conferidos linha a linha, entao rodar isto hoje e no-op.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."whatsapp_list_conversations"("p_tenant_id" "uuid", "p_bucket" "text" DEFAULT NULL::"text", "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_instance_id" "uuid" DEFAULT NULL::"uuid", "p_instance_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_status" "text" DEFAULT NULL::"text", "p_assigned_to" "uuid" DEFAULT NULL::"uuid", "p_unassigned" boolean DEFAULT false, "p_unread_only" boolean DEFAULT false, "p_is_group" boolean DEFAULT false, "p_include_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_closed_visible_to" "uuid" DEFAULT NULL::"uuid", "p_auto_reply_disabled_only" boolean DEFAULT false, "p_rules_disabled_only" boolean DEFAULT false, "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("conversation" "jsonb", "contact" "jsonb", "bucket" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
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
$$;


COMMENT ON FUNCTION "public"."whatsapp_list_conversations"("p_tenant_id" "uuid", "p_bucket" "text", "p_department_id" "uuid", "p_instance_id" "uuid", "p_instance_ids" "uuid"[], "p_status" "text", "p_assigned_to" "uuid", "p_unassigned" boolean, "p_unread_only" boolean, "p_is_group" boolean, "p_include_ids" "uuid"[], "p_closed_visible_to" "uuid", "p_auto_reply_disabled_only" boolean, "p_rules_disabled_only" boolean, "p_limit" integer, "p_offset" integer) IS 'DEM-0234: lista de conversas do chat, filtrada por bucket e paginada NO SERVIDOR. Substitui a janela fixa de 100 linhas + filtro de bucket no cliente, que tornava conversa encerrada antiga inalcancavel. Compartilha wa_conversation_bucket com whatsapp_pill_counts para lista e contagem nunca divergirem. O filtro de operador usa COALESCE(dono do atendimento ativo, dono da conversa) — a mesma fonte que o cabecalho da tela mostra, e a unica que existe em grupo e em conversa aberta por ticket — mais o monitor; em conversa encerrada cai em wa_last_attendance_owner, porque o fechamento zera whatsapp_conversations.assigned_to.';

CREATE OR REPLACE FUNCTION "public"."wa_pill_scope"("p_tenant_id" "uuid", "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_closed_visible_to" "uuid" DEFAULT NULL::"uuid", "p_assigned_to" "uuid" DEFAULT NULL::"uuid", "p_unassigned" boolean DEFAULT false, "p_instance_id" "uuid" DEFAULT NULL::"uuid", "p_instance_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_status" "text" DEFAULT NULL::"text", "p_auto_reply_disabled_only" boolean DEFAULT false, "p_rules_disabled_only" boolean DEFAULT false) RETURNS TABLE("conversation_id" "uuid", "unread_count" integer, "awaiting" boolean, "pills" "text"[])
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH base AS (
    SELECT
      c.id,
      COALESCE(c.unread_count, 0)                     AS unread_count,
      sa.awaiting_agent_since IS NOT NULL             AS awaiting,
      COALESCE(c.is_group, false)                     AS is_group,
      COALESCE(c.group_enabled, false)                AS group_enabled,
      public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) AS bucket,

      -- Um flag por filtro da UI. Cada pill escolhe abaixo quais respeita —
      -- e a escolha e a mesma que ConversationsSidebar faz ao montar os
      -- parametros de whatsapp_list_conversations.
      (p_department_id IS NULL
        OR c.department_id = p_department_id
        OR c.department_id IS NULL)                   AS f_dept,
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
      AND (c.last_message_at IS NOT NULL OR sa.status IS NOT NULL)
  )
  SELECT b.id, b.unread_count, b.awaiting, x.pills
  FROM base b
  CROSS JOIN LATERAL (
    SELECT ARRAY_REMOVE(ARRAY[
      -- Fila e Fora do horario: sem operador, sem auto-resposta, sem regras.
      CASE WHEN NOT b.is_group AND b.bucket = 'waiting'
                AND b.f_dept AND b.f_inst AND b.f_status
           THEN 'waiting' END,
      CASE WHEN NOT b.is_group AND b.bucket = 'after_hours'
                AND b.f_dept AND b.f_inst AND b.f_status
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
      CASE WHEN b.f_dept AND b.f_inst AND b.f_status
                AND b.f_assigned AND b.f_unassigned AND b.f_auto AND b.f_rules
                AND b.f_closed_vis
           THEN 'all' END
    ], NULL) AS pills
  ) x
  WHERE cardinality(x.pills) > 0;
$$;


COMMENT ON FUNCTION "public"."wa_pill_scope"("p_tenant_id" "uuid", "p_department_id" "uuid", "p_closed_visible_to" "uuid", "p_assigned_to" "uuid", "p_unassigned" boolean, "p_instance_id" "uuid", "p_instance_ids" "uuid"[], "p_status" "text", "p_auto_reply_disabled_only" boolean, "p_rules_disabled_only" boolean) IS 'DEM-0258: de quais pills do Chat cada conversa participa, aplicando os mesmos filtros que whatsapp_list_conversations recebe da tela. Fonte unica de whatsapp_pill_counts e whatsapp_mark_bucket_read — nao duplicar a regra. A pill Grupos segue o setor desde que grupo passou a ter setor proprio. O filtro de operador usa COALESCE(dono do atendimento ativo, dono da conversa) mais o monitor; em conversa encerrada cai em wa_last_attendance_owner, porque o fechamento zera whatsapp_conversations.assigned_to.';
