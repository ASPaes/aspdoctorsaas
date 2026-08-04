-- DEM-0234 — conversas encerradas somem da lista
--
-- Causa: a pill contava o bucket sobre o tenant inteiro (whatsapp_pill_counts) e a
-- lista classificava o mesmo bucket sobre as 100 linhas mais recentes ja carregadas
-- no browser. Conversa encerrada fora dessa janela virava inalcancavel.
--
-- Correcao: a classificacao vira UMA funcao (wa_conversation_bucket), usada pela
-- contagem e pela nova RPC de listagem. Lista e contagem passam a ser a mesma
-- expressao, entao nao tem como divergir.

-- 1) Classificacao de bucket — fonte unica -----------------------------------
CREATE OR REPLACE FUNCTION public.wa_conversation_bucket(
  p_conversation_status text,
  p_attendance_status   text,
  p_opened_out_of_hours boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_conversation_status = 'closed'       THEN 'closed'
    WHEN p_attendance_status   = 'in_progress'  THEN 'in_progress'
    WHEN COALESCE(p_opened_out_of_hours, false) THEN 'after_hours'
    WHEN p_attendance_status IS NULL            THEN 'closed'
    ELSE 'waiting'
  END;
$$;

COMMENT ON FUNCTION public.wa_conversation_bucket(text, text, boolean) IS
  'Bucket de uma conversa no chat (closed | in_progress | after_hours | waiting). '
  'Fonte unica: usada por whatsapp_pill_counts e whatsapp_list_conversations. '
  'p_attendance_status e o status do atendimento ATIVO (waiting|in_progress) ou NULL. '
  'DEM-0234: nao duplicar esta regra em lugar nenhum, inclusive no frontend.';

REVOKE ALL ON FUNCTION public.wa_conversation_bucket(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wa_conversation_bucket(text, text, boolean)
  TO authenticated, service_role;

-- 2) whatsapp_pill_counts passa a chamar a funcao ----------------------------
-- Refactor sem mudanca de comportamento: mesma arvore de decisao, mesma ordem.
-- ATENCAO: p_closed_visible_to muda a ARIDADE. CREATE OR REPLACE com um parametro
-- a mais nao substitui — cria uma SOBRECARGA. As duas coexistindo tornam a chamada
-- atual do frontend (2 argumentos nomeados) ambigua e a contagem das pills quebra
-- em producao no instante do deploy. O DROP da versao antiga e obrigatorio e tem
-- que vir antes do CREATE.
DROP FUNCTION IF EXISTS public.whatsapp_pill_counts(uuid, uuid);

CREATE OR REPLACE FUNCTION public.whatsapp_pill_counts(
  p_tenant_id uuid,
  p_department_id uuid DEFAULT NULL::uuid,
  p_closed_visible_to uuid DEFAULT NULL::uuid
)
RETURNS TABLE(bucket text, total_conversas bigint, conversas_nao_lidas bigint, aguardando bigint, msgs_nao_lidas bigint)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT v.conversation_id, v.tenant_id, v.unread_count,
           v.awaiting_agent_since, v.department_id,
           public.wa_conversation_bucket(
             v.conversation_status, v.attendance_status, v.opened_out_of_hours
           ) AS bucket
    FROM public.v_whatsapp_conversations_state v
    WHERE v.is_group = false
      AND v.tenant_id = p_tenant_id
      -- Mesma populacao que whatsapp_list_conversations consegue devolver.
      -- Conversa sem nenhuma mensagem E sem atendimento ativo nao e alcancavel
      -- na lista; contar aqui inflava a pill com linha que ninguem abre. Era o
      -- mesmo defeito do DEM-0234 em escala menor.
      AND (v.last_message_at IS NOT NULL OR v.attendance_status IS NOT NULL)
  ),
  visivel AS (
    -- Mesma regra de visibilidade de encerradas da RPC de listagem.
    SELECT b.* FROM base b
    WHERE p_closed_visible_to IS NULL
       OR b.bucket <> 'closed'
       OR COALESCE(
            (SELECT s.assigned_to
             FROM public.support_attendances s
             WHERE s.conversation_id = b.conversation_id
               AND s.tenant_id       = b.tenant_id
             ORDER BY s.opened_at DESC NULLS LAST, s.created_at DESC
             LIMIT 1),
            p_closed_visible_to
          ) = p_closed_visible_to
  )
  SELECT bucket,
         count(*),
         count(*) FILTER (WHERE unread_count > 0),
         count(*) FILTER (WHERE awaiting_agent_since IS NOT NULL),
         COALESCE(sum(unread_count), 0)
  FROM visivel
  WHERE p_department_id IS NULL OR department_id = p_department_id OR bucket = 'after_hours'
  GROUP BY bucket;
$function$;

-- O DROP acima levou junto os grants da versao antiga; refazer.
REVOKE ALL ON FUNCTION public.whatsapp_pill_counts(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_pill_counts(uuid, uuid, uuid)
  TO authenticated, service_role;

-- 3) Listagem paginada e filtrada por bucket NO SERVIDOR ---------------------
-- SECURITY INVOKER (default): o RLS de whatsapp_conversations continua valendo.
--
-- Retorna a conversa e o contato como jsonb para replicar exatamente o
-- `select *, contact:whatsapp_contacts(*)` que a lista usava — sem risco de a
-- RPC ficar para tras quando alguem adicionar coluna.
--
-- Ordenacao e WHERE preservam o caminho de idx_wa_conv_tenant_lastmsg_active
-- (tenant_id, last_message_at DESC NULLS LAST) WHERE last_message_at IS NOT NULL.
-- Nao usar OR aqui: foi o que derrubou esse indice antes (963ms na lista).
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
    AND (p_assigned_to   IS NULL  OR c.assigned_to = p_assigned_to OR c.monitor_user_id = p_assigned_to)
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
  'whatsapp_pill_counts para lista e contagem nunca divergirem.';

REVOKE ALL ON FUNCTION public.whatsapp_list_conversations(
  uuid, text, uuid, uuid, uuid[], text, uuid, boolean, boolean, boolean, uuid[], uuid, boolean, boolean, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_list_conversations(
  uuid, text, uuid, uuid, uuid[], text, uuid, boolean, boolean, boolean, uuid[], uuid, boolean, boolean, integer, integer
) TO authenticated, service_role;
