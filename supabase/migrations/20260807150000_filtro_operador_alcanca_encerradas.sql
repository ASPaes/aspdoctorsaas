-- Filtro "Operador" + aba "Encerrados" devolvia ZERO para todo mundo
--
-- Causa: ao encerrar, fn_clear_conversation_assigned_on_close zera
-- whatsapp_conversations.assigned_to (e department_id) de proposito — libera a
-- conversa. O filtro de operador da sidebar comparava exatamente essa coluna,
-- tanto na lista (whatsapp_list_conversations) quanto na contagem das pills
-- (wa_pill_scope). Como TODA encerrada tem assigned_to NULL, a combinacao
-- "Encerrados + qualquer operador" nao devolvia nada — nao era um operador
-- especifico, eram 100% dos casos, e a pill zerava junto.
--
-- O operador NAO se perde no encerramento: fica em support_attendances
-- (assigned_to = quem atendeu, closed_by = quem clicou em encerrar). Nenhum
-- trigger de fechamento limpa esses campos. A propria wa_pill_scope ja le dali
-- na regra de visibilidade de encerradas (f_closed_vis) — e so o filtro de
-- operador passar a ler da mesma fonte quando o bucket e 'closed'.
--
-- As DUAS funcoes mudam no mesmo commit: lista e contagem tem que sair da mesma
-- expressao, senao volta a divergir como no DEM-0234.
--
-- Mesma aridade nas duas -> CREATE OR REPLACE basta, sem DROP.

-- 1) Dono do ultimo atendimento da conversa — fonte unica ---------------------
-- Mesma ordenacao de f_closed_vis (ultimo atendimento por opened_at), servida
-- pelo indice ix_support_attendances_lookup_lateral
-- (conversation_id, opened_at DESC NULLS LAST, created_at DESC). Nao precisa de
-- indice novo.
--
-- COALESCE(assigned_to, closed_by): cobre o atendimento que ninguem assumiu e
-- foi encerrado por um admin — ali assigned_to e NULL e quem encerrou so existe
-- em closed_by.
--
-- SECURITY INVOKER (default) de proposito: o RLS de support_attendances
-- continua valendo, igual a subquery inline que ela substitui. Sem
-- SET search_path para o planner poder inline-ar a funcao no plano (funcao SQL
-- com SET clause nao e inlineavel) — por isso as referencias sao qualificadas.
CREATE OR REPLACE FUNCTION public.wa_last_attendance_owner(
  p_conversation_id uuid,
  p_tenant_id       uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $function$
  SELECT COALESCE(s.assigned_to, s.closed_by)
  FROM public.support_attendances s
  WHERE s.conversation_id = p_conversation_id
    AND s.tenant_id       = p_tenant_id
  ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
  LIMIT 1;
$function$;

COMMENT ON FUNCTION public.wa_last_attendance_owner(uuid, uuid) IS
  'Operador do ultimo atendimento da conversa (assigned_to, ou closed_by quando '
  'ninguem assumiu). Existe porque o encerramento zera '
  'whatsapp_conversations.assigned_to: e daqui que o filtro de operador do chat '
  'descobre de quem foi uma conversa encerrada. Fonte unica de '
  'whatsapp_list_conversations e wa_pill_scope — nao duplicar a regra.';

REVOKE ALL ON FUNCTION public.wa_last_attendance_owner(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wa_last_attendance_owner(uuid, uuid)
  TO authenticated, service_role;

-- 2) Lista -------------------------------------------------------------------
-- Unica alteracao em relacao a 20260804040000_dem0234_lista_conversas_por_bucket.sql:
-- o predicado de p_assigned_to. Todo o resto e identico.
CREATE OR REPLACE FUNCTION public.whatsapp_list_conversations(
  p_tenant_id     uuid,
  p_bucket        text    DEFAULT NULL,
  p_department_id uuid    DEFAULT NULL,
  p_instance_id   uuid    DEFAULT NULL,
  p_instance_ids  uuid[]  DEFAULT NULL,
  p_status        text    DEFAULT NULL,
  p_assigned_to   uuid    DEFAULT NULL,
  p_unassigned    boolean DEFAULT false,
  p_unread_only   boolean DEFAULT false,
  p_is_group      boolean DEFAULT false,
  p_include_ids   uuid[]  DEFAULT NULL,
  p_closed_visible_to uuid DEFAULT NULL,
  p_auto_reply_disabled_only boolean DEFAULT false,
  p_rules_disabled_only      boolean DEFAULT false,
  p_limit         integer DEFAULT 50,
  p_offset        integer DEFAULT 0
)
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
  WITH pagina AS MATERIALIZED (
    SELECT
      c AS conv,
      public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) AS bucket
    FROM public.whatsapp_conversations c
    LEFT JOIN LATERAL (
    -- support_attendances_one_active_per_conversation garante no maximo 1 linha.
    SELECT s.status
    FROM public.support_attendances s
    WHERE s.conversation_id = c.id
      AND s.tenant_id       = c.tenant_id
      AND s.status IN ('waiting', 'in_progress')
    ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1
  ) sa ON true
  WHERE c.tenant_id = p_tenant_id
    -- Conversa recem-criada ainda nao tem last_message_at; so entra se pedida
    -- explicitamente por id (atendimento ativo / conversa acabada de abrir).
    AND (
      c.last_message_at IS NOT NULL
      OR c.id = ANY(COALESCE(p_include_ids, ARRAY[]::uuid[]))
    )
    AND (p_is_group      IS NULL  OR c.is_group = p_is_group)
    AND (p_is_group      IS NOT TRUE OR c.group_enabled = true)
    AND (p_department_id IS NULL  OR c.department_id = p_department_id OR c.department_id IS NULL)
    AND (p_instance_ids  IS NULL  OR c.instance_id = ANY(p_instance_ids))
    AND (p_instance_id   IS NULL  OR c.instance_id = p_instance_id)
    AND (p_status        IS NULL  OR c.status = p_status)
    -- Filtro de operador. O terceiro OR existe porque conversa ENCERRADA nao tem
    -- dono: fn_clear_conversation_assigned_on_close zera c.assigned_to no
    -- fechamento. Sem ele, "Encerrados + operador" devolvia zero sempre.
    -- A subquery so e alcancada quando p_assigned_to esta preenchido, a conversa
    -- nao bate por c.assigned_to/monitor e o bucket e 'closed' — as tres
    -- condicoes baratas vem antes de proposito.
    AND (
      p_assigned_to    IS NULL
      OR c.assigned_to     = p_assigned_to
      OR c.monitor_user_id = p_assigned_to
      OR (
        public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'closed'
        AND public.wa_last_attendance_owner(c.id, c.tenant_id) = p_assigned_to
      )
    )
    AND (p_unassigned    IS NOT TRUE OR c.assigned_to IS NULL)
    AND (p_unread_only   IS NOT TRUE OR c.unread_count > 0)
    -- Filtros do popover. Ficavam no cliente e encolhiam a pagina ja paginada —
    -- mesmo defeito do DEM-0234, so que disparado por opcao do usuario.
    AND (p_auto_reply_disabled_only IS NOT TRUE OR c.auto_reply_disabled = true)
    -- EXISTS por PK, e so quando o filtro esta ligado: nao arrasta
    -- whatsapp_contacts para dentro do caminho ordenado.
    AND (p_rules_disabled_only      IS NOT TRUE OR EXISTS (
          SELECT 1 FROM public.whatsapp_contacts ct2
          WHERE ct2.id = c.contact_id AND ct2.rules_disabled = true))
    AND (
      p_bucket IS NULL
      OR public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = p_bucket
    )
    -- Visibilidade de encerradas para quem nao e admin/head: so as que foram dele.
    -- Antes isso era filtro no cliente; ali recriava o proprio DEM-0234 para o
    -- operador comum, porque encolhia a pagina depois de paginada.
    -- Subquery escalar (nao LATERAL) de proposito: com p_closed_visible_to NULL
    -- o OR curto-circuita e ela nao chega a ser avaliada.
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
  )
  SELECT
    to_jsonb(p.conv) AS conversation,
    to_jsonb(ct)     AS contact,
    p.bucket
  FROM pagina p
  JOIN public.whatsapp_contacts ct ON ct.id = (p.conv).contact_id
  ORDER BY (p.conv).last_message_at DESC NULLS LAST;
$function$;

COMMENT ON FUNCTION public.whatsapp_list_conversations IS
  'DEM-0234: lista de conversas do chat, filtrada por bucket e paginada NO SERVIDOR. '
  'Substitui a janela fixa de 100 linhas + filtro de bucket no cliente, que tornava '
  'conversa encerrada antiga inalcancavel. Compartilha wa_conversation_bucket com '
  'whatsapp_pill_counts para lista e contagem nunca divergirem. O filtro de operador '
  'cai em wa_last_attendance_owner quando a conversa esta encerrada, porque o '
  'fechamento zera whatsapp_conversations.assigned_to.';

-- 3) Contagem das pills ------------------------------------------------------
-- Unica alteracao em relacao a 20260806190000_pill_grupos_segue_setor.sql:
-- o f_assigned. whatsapp_pill_counts e whatsapp_mark_bucket_read leem desta
-- funcao e pegam a correcao de graca.
CREATE OR REPLACE FUNCTION public.wa_pill_scope(
  p_tenant_id                uuid,
  p_department_id            uuid    DEFAULT NULL,
  p_closed_visible_to        uuid    DEFAULT NULL,
  p_assigned_to              uuid    DEFAULT NULL,
  p_unassigned               boolean DEFAULT false,
  p_instance_id              uuid    DEFAULT NULL,
  p_instance_ids             uuid[]  DEFAULT NULL,
  p_status                   text    DEFAULT NULL,
  p_auto_reply_disabled_only boolean DEFAULT false,
  p_rules_disabled_only      boolean DEFAULT false
)
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
      -- monitor_user_id entra junto: quem monitora ve na lista, entao conta.
      -- O ultimo OR e o mesmo da lista: encerrada nao tem c.assigned_to (o
      -- fechamento zera), entao o dono vem do ultimo atendimento. Sem ele a pill
      -- Encerrados zerava junto com a lista assim que um operador era escolhido.
      (p_assigned_to IS NULL
        OR c.assigned_to = p_assigned_to
        OR c.monitor_user_id = p_assigned_to
        OR (public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'closed'
            AND public.wa_last_attendance_owner(c.id, c.tenant_id) = p_assigned_to)) AS f_assigned,
      (p_unassigned IS NOT TRUE OR c.assigned_to IS NULL) AS f_unassigned,
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
      SELECT s.status, s.awaiting_agent_since
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
$function$;

COMMENT ON FUNCTION public.wa_pill_scope IS
  'DEM-0258: de quais pills do Chat cada conversa participa, aplicando os mesmos '
  'filtros que whatsapp_list_conversations recebe da tela. Fonte unica de '
  'whatsapp_pill_counts e whatsapp_mark_bucket_read — nao duplicar a regra. '
  'A pill Grupos segue o setor desde que grupo passou a ter setor proprio. '
  'O filtro de operador cai em wa_last_attendance_owner quando a conversa esta '
  'encerrada, porque o fechamento zera whatsapp_conversations.assigned_to.';
