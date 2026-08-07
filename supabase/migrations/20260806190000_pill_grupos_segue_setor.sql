-- Pill "Grupos" passa a seguir o filtro de setor
--
-- Contexto: quando wa_pill_scope foi escrita (DEM-0258), grupo nao tinha setor —
-- whatsapp_conversations.department_id era forcado a NULL por enforce_group_rules.
-- Dispensar f_dept na pill 'groups' era a unica leitura possivel.
--
-- Depois de 20260806180000_grupo_setor_visibilidade_notificacao.sql o grupo tem
-- setor proprio (whatsapp_groups.department_id) e a conversa o herda. Sem esta
-- mudanca a pill continuaria contando o tenant inteiro enquanto a lista ja
-- mostraria so os do setor — o mesmo descompasso que o DEM-0258 corrigiu.
--
-- Unica alteracao: "AND b.f_dept" no CASE de 'groups'. Grupo sem setor tem
-- department_id NULL e f_dept ja e true nesse caso (OR c.department_id IS NULL),
-- entao continua contando para todos. Instancia e status seguem dispensados.
--
-- Mesma aridade -> CREATE OR REPLACE basta, sem DROP e sem mexer em
-- whatsapp_pill_counts / whatsapp_mark_bucket_read, que leem desta funcao.

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
      (p_assigned_to IS NULL
        OR c.assigned_to = p_assigned_to
        OR c.monitor_user_id = p_assigned_to)         AS f_assigned,
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
  'A pill Grupos segue o setor desde que grupo passou a ter setor proprio.';
