-- A FILA passa a ser do setor, e nao do tenant (23/08/2026)
--
-- Segunda metade da queixa do dia: mesmo com setor configurado, o alerta e a
-- pill "Fila" contavam conversa que nao e daquele setor.
--
-- Causa: o filtro de setor da fila termina com "OR c.department_id IS NULL", ou
-- seja, CONVERSA SEM SETOR CONTA PARA TODOS OS SETORES.
--
-- E conversa sem setor nao e excecao neste sistema:
--   * fn_clear_conversation_assigned_on_close zera assigned_to E department_id a
--     cada encerramento de atendimento;
--   * fn_auto_assign_dept_by_instance DESISTE de derivar o setor quando a URA
--     esta ligada e a instancia nao tem skip_ura -- que e a configuracao normal.
-- Medido em producao em 23/08/2026, conversas na fila sem setor: alesouzapaes
-- 28 de 28, PS Tecnologia 5 de 7, CTM 1 de 4, Athuz 1 de 3.
--
-- NAO DA PARA SIMPLESMENTE APAGAR O "OR ... IS NULL". Essas conversas sumiriam
-- da fila de todo mundo, e elas ja sao as mais frageis do sistema: sem setor,
-- fn_assign_conversation_if_ready sai em 'no_department' e elas NUNCA sao
-- distribuidas. Ficariam encalhadas e invisiveis -- pior que o ruido.
--
-- Regra nova: conversa sem setor pertence aos setores da INSTANCIA dela
-- (support_department_instances). A instancia de WhatsApp ja e repartida por
-- setor, entao esse conjunto e sempre mais estreito que o tenant. E se a
-- instancia nao tiver setor nenhum configurado, a conversa continua caindo para
-- todos -- a rede que garante que nenhuma fila fica invisivel.
--
-- ESCOPO DELIBERADAMENTE ESTREITO: muda a FILA, nao a lista geral.
--   * whatsapp_list_queue  -> e a lista da aba Fila (DEM-0227, ordem FIFO).
--   * wa_pill_scope        -> ganha f_dept_fila, usado SO nos ramos 'waiting' e
--                             'after_hours'. Os demais ramos continuam no f_dept
--                             de sempre.
-- whatsapp_list_conversations NAO e tocada. Ela serve as abas Atendendo,
-- Encerrados, Grupos e Todos, e continua casando com o f_dept dessas pills.
-- Nenhuma pill passa a divergir da sua lista -- que e o defeito que o DEM-0234 e
-- o DEM-0258 ja custaram duas vezes.
--
-- Sao duas regras de setor coexistindo de proposito, porque descrevem coisas
-- diferentes: "quem pode VER esta conversa" (visibilidade, f_dept) e "de quem e
-- a responsabilidade de atender esta fila" (f_dept_fila). Ver e responder nao
-- precisam do mesmo escopo.
--
-- CUSTO: os dois arrays sao subqueries escalares nao correlacionadas -- InitPlan,
-- avaliado UMA vez por chamada, nao por linha. Foi por isso que eles entraram
-- como (SELECT funcao(...)) e nao como chamada direta da funcao: chamada direta
-- de funcao STABLE o planner pode reavaliar por linha. Nenhum predicado de
-- indice muda, entao o caminho de acesso das duas funcoes e o mesmo de hoje.
--
-- O COALESCE em volta de cada (SELECT ...) NAO e defesa contra NULL -- as duas
-- helpers ja devolvem ARRAY[]::uuid[] em vez de NULL. Ele existe por causa do
-- PARSER: em "x = ANY ((SELECT ...))" o Postgres le a forma ANY(subquery), que
-- espera um conjunto de LINHAS, e falha com "operator does not exist:
-- uuid = uuid[]". Envolver em COALESCE torna o argumento uma expressao de
-- array e seleciona a forma ANY(array), sem tirar a subquery do InitPlan.
--
-- Os corpos abaixo sao os de PRODUCAO (dump de 23/08/2026), com exatamente as
-- alteracoes descritas -- conferido por diff contra o dump antes de commitar.
--
-- Mesma aridade nas duas -> CREATE OR REPLACE basta, sem DROP, e os GRANTs
-- existentes sao preservados.

-- ---------------------------------------------------------------------------
-- 1) Helpers: o conjunto de instancias, resolvido uma vez por chamada
--
-- SECURITY INVOKER de proposito. A policy support_department_instances_rw ja
-- devolve as linhas do proprio tenant (e todas, para super admin). Se algum dia
-- alguem chamar com um tenant que nao e o seu, o RLS devolve vazio, os dois
-- arrays ficam vazios e o predicado degrada para o comportamento de HOJE
-- (conversa sem setor aparece para todos). Falha abrindo, nunca escondendo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wa_dept_instance_ids(p_tenant_id uuid, p_department_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT sdi.instance_id), ARRAY[]::uuid[])
  FROM public.support_department_instances sdi
  WHERE sdi.tenant_id     = p_tenant_id
    AND sdi.department_id = p_department_id
    AND sdi.is_active     = true;
$function$;

COMMENT ON FUNCTION public.wa_dept_instance_ids(uuid, uuid) IS
  'Instancias de WhatsApp que respondem por um setor. Usada pelo escopo da fila '
  'em wa_pill_scope e whatsapp_list_queue -- nao duplicar a regra.';

CREATE OR REPLACE FUNCTION public.wa_instances_with_dept(p_tenant_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(DISTINCT sdi.instance_id), ARRAY[]::uuid[])
  FROM public.support_department_instances sdi
  WHERE sdi.tenant_id = p_tenant_id
    AND sdi.is_active = true;
$function$;

COMMENT ON FUNCTION public.wa_instances_with_dept(uuid) IS
  'Instancias que tem ALGUM setor configurado. O complemento dela e a rede de '
  'seguranca do escopo da fila: instancia fora desta lista nao tem dono de '
  'setor, entao a conversa sem setor dela continua visivel para todos.';

GRANT EXECUTE ON FUNCTION public.wa_dept_instance_ids(uuid, uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_instances_with_dept(uuid)      TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) wa_pill_scope: f_dept_fila nos ramos 'waiting' e 'after_hours'
-- ---------------------------------------------------------------------------
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
      AND (c.last_message_at IS NOT NULL OR sa.status IS NOT NULL)
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
      CASE WHEN b.f_dept AND b.f_inst AND b.f_status
                AND b.f_assigned AND b.f_unassigned AND b.f_auto AND b.f_rules
                AND b.f_closed_vis
           THEN 'all' END
    ], NULL) AS pills
  ) x
  WHERE cardinality(x.pills) > 0;
$$;

-- ---------------------------------------------------------------------------
-- 3) whatsapp_list_queue: a lista da aba Fila segue o mesmo escopo da pill
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."whatsapp_list_queue"("p_tenant_id" "uuid", "p_department_id" "uuid" DEFAULT NULL::"uuid", "p_instance_id" "uuid" DEFAULT NULL::"uuid", "p_instance_ids" "uuid"[] DEFAULT NULL::"uuid"[], "p_status" "text" DEFAULT NULL::"text", "p_unread_only" boolean DEFAULT false, "p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0) RETURNS TABLE("conversation" "jsonb", "contact" "jsonb", "bucket" "text", "queue_since" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH pagina AS MATERIALIZED (
    SELECT
      c AS conv,
      COALESCE(sa.awaiting_agent_since, sa.queued_at, sa.opened_at) AS queue_since
    FROM public.support_attendances sa
    JOIN public.whatsapp_conversations c
      ON c.id = sa.conversation_id
     AND c.tenant_id = sa.tenant_id
    WHERE sa.tenant_id = p_tenant_id
      AND sa.status    = 'waiting'
      AND c.is_group   = false
      AND public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'waiting'
      AND (p_department_id IS NULL
           OR c.department_id = p_department_id
           OR (c.department_id IS NULL
               AND (c.instance_id = ANY(COALESCE((SELECT public.wa_dept_instance_ids(p_tenant_id, p_department_id)), ARRAY[]::uuid[]))
                    OR NOT (c.instance_id = ANY(COALESCE((SELECT public.wa_instances_with_dept(p_tenant_id)), ARRAY[]::uuid[]))))))
      AND (p_instance_ids  IS NULL OR c.instance_id = ANY(p_instance_ids))
      AND (p_instance_id   IS NULL OR c.instance_id = p_instance_id)
      AND (p_status        IS NULL OR c.status = p_status)
      AND (p_unread_only IS NOT TRUE OR c.unread_count > 0)
    ORDER BY COALESCE(sa.awaiting_agent_since, sa.queued_at, sa.opened_at) ASC
    LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT
    to_jsonb(p.conv) AS conversation,
    to_jsonb(ct)     AS contact,
    'waiting'::text  AS bucket,
    p.queue_since
  FROM pagina p
  JOIN public.whatsapp_contacts ct ON ct.id = (p.conv).contact_id
  ORDER BY p.queue_since ASC;
$$;
