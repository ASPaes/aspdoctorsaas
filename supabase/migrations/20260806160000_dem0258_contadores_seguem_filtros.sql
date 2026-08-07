-- DEM-0258 — pills do Chat contam o tenant inteiro, a lista nao
--
-- Causa: whatsapp_list_conversations recebe os filtros da tela (operador,
-- instancia, status, setor); os contadores nao. whatsapp_pill_counts so recebia
-- tenant + setor + closed_visible_to, e a pill "Grupos" nem RPC tinha — eram 3
-- queries soltas no ConversationsSidebar contando tenant_id + is_group. Com o
-- chip "Operador" ligado a lista mostrava 7 grupos e a pill dizia 40.
--
-- Correcao: uma funcao (wa_pill_scope) decide de quais pills cada conversa
-- participa, aplicando EXATAMENTE os mesmos filtros que a lista aplica — e as
-- mesmas dispensas por pill que a UI ja faz hoje:
--   * Fila / Fora do horario  -> ignoram operador (o chip aparece riscado, com
--                                 "Nao se aplica nesta aba"), auto-resposta e regras.
--   * Grupos                  -> ignoram setor, instancia e status (grupo e visivel
--                                 para todo agente do tenant, independente de setor),
--                                 mas seguem o operador.
--   * Atendendo / Encerrados  -> tudo.
--   * Todos                   -> tudo, com grupos incluidos (a lista de "Todos"
--                                 chama a RPC com p_is_group = NULL).
--
-- whatsapp_pill_counts e whatsapp_mark_bucket_read passam a ler dessa funcao.
-- O numero da pill, a lista e o "Marcar todas como lidas" ficam sendo a mesma
-- expressao — mesmo principio do DEM-0234, agora valendo tambem para os filtros.
--
-- ATENCAO (mesma pegadinha do DEM-0234): as duas funcoes MUDAM DE ARIDADE.
-- CREATE OR REPLACE com parametro a mais nao substitui, cria SOBRECARGA, e as
-- duas coexistindo tornam a chamada do frontend ambigua. O DROP e obrigatorio.
--
-- Ordem de publicacao: este SQL PRIMEIRO, frontend depois. Como todos os
-- parametros novos tem DEFAULT, o frontend antigo (3 argumentos nomeados)
-- continua funcionando na janela entre os dois.

-- 1) Escopo das pills — fonte unica -----------------------------------------
-- SECURITY INVOKER (default): o RLS de whatsapp_conversations continua valendo.
--
-- Le whatsapp_conversations + support_attendances direto, NAO
-- v_whatsapp_conversations_state: a view junta support_departments,
-- configuracoes e chama fn_business_due_at por linha, e nada disso e usado aqui.
-- Sai uma varredura por chamada, em vez da view inteira num poll de 60s.
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
      CASE WHEN b.is_group AND b.group_enabled AND b.f_assigned
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
  'whatsapp_pill_counts e whatsapp_mark_bucket_read — nao duplicar a regra.';

REVOKE ALL ON FUNCTION public.wa_pill_scope(
  uuid, uuid, uuid, uuid, boolean, uuid, uuid[], text, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wa_pill_scope(
  uuid, uuid, uuid, uuid, boolean, uuid, uuid[], text, boolean, boolean
) TO authenticated, service_role;

-- 2) whatsapp_pill_counts — agora com os filtros da tela -----------------------
-- Passa a devolver tambem as linhas 'groups' e 'all', que antes eram calculadas
-- fora: 'groups' em 3 queries soltas no frontend (sem filtro nenhum) e 'all'
-- somando as quatro pills no navegador (que ignorava grupos).
DROP FUNCTION IF EXISTS public.whatsapp_pill_counts(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.whatsapp_pill_counts(
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
RETURNS TABLE(bucket text, total_conversas bigint, conversas_nao_lidas bigint, aguardando bigint, msgs_nao_lidas bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT
    p                                              AS bucket,
    count(*)                                       AS total_conversas,
    count(*) FILTER (WHERE s.unread_count > 0)     AS conversas_nao_lidas,
    count(*) FILTER (WHERE s.awaiting)             AS aguardando,
    COALESCE(sum(s.unread_count), 0)               AS msgs_nao_lidas
  FROM public.wa_pill_scope(
         p_tenant_id, p_department_id, p_closed_visible_to, p_assigned_to,
         p_unassigned, p_instance_id, p_instance_ids, p_status,
         p_auto_reply_disabled_only, p_rules_disabled_only
       ) s
  CROSS JOIN LATERAL unnest(s.pills) AS p
  GROUP BY p;
$function$;

COMMENT ON FUNCTION public.whatsapp_pill_counts IS
  'DEM-0258: contagem das pills do Chat (waiting | in_progress | after_hours | '
  'closed | groups | all), pelos mesmos filtros da lista. ATENCAO: "all" inclui '
  'grupos e por isso nao e a soma das demais — nao somar no frontend.';

REVOKE ALL ON FUNCTION public.whatsapp_pill_counts(
  uuid, uuid, uuid, uuid, boolean, uuid, uuid[], text, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_pill_counts(
  uuid, uuid, uuid, uuid, boolean, uuid, uuid[], text, boolean, boolean
) TO authenticated, service_role;

-- 3) whatsapp_mark_bucket_read — mesmo escopo do numero que o dialogo mostra ---
-- O dialogo diz "Marcar N conversas como lidas" lendo a pill. Se a pill passa a
-- respeitar o filtro e a marcacao nao, o botao zera o tenant inteiro achando que
-- zerou as N da aba. Os dois tem que sair do mesmo escopo.
DROP FUNCTION IF EXISTS public.whatsapp_mark_bucket_read(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.whatsapp_mark_bucket_read(
  p_tenant_id                uuid,
  p_bucket                   text,
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
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids   uuid[];
  v_count integer;
BEGIN
  SELECT array_agg(s.conversation_id) INTO v_ids
  FROM public.wa_pill_scope(
         p_tenant_id, p_department_id, p_closed_visible_to, p_assigned_to,
         p_unassigned, p_instance_id, p_instance_ids, p_status,
         p_auto_reply_disabled_only, p_rules_disabled_only
       ) s
  WHERE s.unread_count > 0
    AND p_bucket = ANY(s.pills);

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.whatsapp_conversations
  SET unread_count = 0
  WHERE id = ANY(v_ids)
    AND tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.audit_events (tenant_id, actor_user_id, event_type, metadata)
  VALUES (
    p_tenant_id, auth.uid(), 'WHATSAPP_MARK_BUCKET_READ',
    jsonb_build_object('bucket', p_bucket, 'department_id', p_department_id, 'affected', v_count)
  );

  RETURN v_count;
END;
$function$;

COMMENT ON FUNCTION public.whatsapp_mark_bucket_read IS
  'DEM-0258: marca como lidas as conversas da pill, no MESMO escopo que '
  'whatsapp_pill_counts contou (wa_pill_scope). Antes marcava o tenant inteiro.';

REVOKE ALL ON FUNCTION public.whatsapp_mark_bucket_read(
  uuid, text, uuid, uuid, uuid, boolean, uuid, uuid[], text, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_mark_bucket_read(
  uuid, text, uuid, uuid, uuid, boolean, uuid, uuid[], text, boolean, boolean
) TO authenticated, service_role;

-- whatsapp_group_unread_sum(uuid) fica orfa a partir daqui (a pill Grupos passa
-- a vir de whatsapp_pill_counts). Nao dropo junto: ela nunca esteve no repo, e
-- derrubar funcao prod-only no mesmo deploy que muda as pills e um risco que nao
-- precisa ser corrido hoje.
