-- DEM-0227 — a Fila nao segue FIFO
--
-- Hoje a pill "Fila" usa whatsapp_list_conversations, que ordena por
-- last_message_at DESC (mais recente primeiro) e pagina NO SERVIDOR. Ou seja:
-- 1) a fila aparece na ordem INVERSA da chegada; e
-- 2) so ordenar no navegador nao resolve — a pagina de 50 e cortada pelo
--    last_message_at DESC, entao quem esta esperando ha mais tempo e
--    exatamente quem fica de fora da pagina. Era o mesmo defeito do DEM-0234.
--
-- Por isso a ordenacao FIFO tem que ser do servidor. Esta RPC e dedicada a
-- fila e inverte a origem da varredura: parte de support_attendances
-- (status='waiting'), nao de whatsapp_conversations. Isso e tambem a
-- otimizacao que ficou pendente no DEM-0234 — a pill "Fila" e a pill PADRAO
-- ao abrir o chat e varria o tenant inteiro (6.000 buffers) para achar ~4
-- conversas. idx_support_attendances_tenant_status (tenant_id, status,
-- opened_at DESC) resolve isso direto.
--
-- A classificacao continua saindo de wa_conversation_bucket — nao ha regra de
-- bucket duplicada aqui (DEM-0234).

CREATE OR REPLACE FUNCTION public.whatsapp_list_queue(
  p_tenant_id     uuid,
  p_department_id uuid    DEFAULT NULL,
  p_instance_id   uuid    DEFAULT NULL,
  p_instance_ids  uuid[]  DEFAULT NULL,
  p_status        text    DEFAULT NULL,
  p_unread_only   boolean DEFAULT false,
  p_limit         integer DEFAULT 50,
  p_offset        integer DEFAULT 0
)
RETURNS TABLE(conversation jsonb, contact jsonb, bucket text, queue_since timestamptz)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  -- SECURITY INVOKER (default): o RLS de support_attendances e de
  -- whatsapp_conversations continua valendo. Um operador comum ja nao enxergava
  -- atendimento de outro setor pela policy support_attendances_select — e a
  -- lista atual tambem nao mostrava (sem a linha do atendimento, o bucket cai em
  -- 'closed'). Trocar a origem da varredura nao muda visibilidade.
  WITH pagina AS MATERIALIZED (
    SELECT
      c AS conv,
      -- Chegada na fila, em ordem de confianca:
      --   awaiting_agent_since — 1a mensagem do cliente ainda sem resposta.
      --     Ancorada na PRIMEIRA (fn_track_awaiting_agent so seta se estiver
      --     vazio), entao cliente impaciente que manda 3 mensagens NAO perde a
      --     vez. E o mesmo carimbo que ja alimenta o alerta de ausencia.
      --   queued_at — so existe quando o motor de distribuicao esta ligado
      --     (distribution_enabled_globally); NULL na maioria dos tenants.
      --   opened_at — NOT NULL, sempre serve de piso.
      COALESCE(sa.awaiting_agent_since, sa.queued_at, sa.opened_at) AS queue_since
    FROM public.support_attendances sa
    -- support_attendances_one_active_per_conversation (unique parcial em
    -- tenant_id, conversation_id WHERE status IN waiting/in_progress) garante no
    -- maximo 1 linha 'waiting' por conversa: o join nao duplica.
    JOIN public.whatsapp_conversations c
      ON c.id = sa.conversation_id
     AND c.tenant_id = sa.tenant_id
    WHERE sa.tenant_id = p_tenant_id
      AND sa.status    = 'waiting'
      AND c.is_group   = false
      -- Fonte unica da classificacao. Exclui conversa encerrada e a que abriu
      -- fora do horario (bucket 'after_hours', pill propria).
      AND public.wa_conversation_bucket(c.status, sa.status, c.opened_out_of_hours) = 'waiting'
      AND (p_department_id IS NULL OR c.department_id = p_department_id OR c.department_id IS NULL)
      AND (p_instance_ids  IS NULL OR c.instance_id = ANY(p_instance_ids))
      AND (p_instance_id   IS NULL OR c.instance_id = p_instance_id)
      AND (p_status        IS NULL OR c.status = p_status)
      AND (p_unread_only IS NOT TRUE OR c.unread_count > 0)
    -- FIFO: quem chegou primeiro, primeiro.
    -- queue_priority DE PROPOSITO fora daqui. O motor de distribuicao ordena por
    -- (queue_priority DESC, queued_at ASC), mas a lista da sidebar e escolha
    -- MANUAL do operador e o pedido do DEM-0227 e cronologico puro. Na pratica
    -- queue_priority so sai de 1 quando alguem marca a conversa como alta/baixa.
    ORDER BY COALESCE(sa.awaiting_agent_since, sa.queued_at, sa.opened_at) ASC
    LIMIT  GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  -- Contato entra depois, por PK, sobre as <=50 linhas que sobraram — mesmo
  -- motivo de whatsapp_list_conversations (ver comentario la).
  SELECT
    to_jsonb(p.conv) AS conversation,
    to_jsonb(ct)     AS contact,
    'waiting'::text  AS bucket,
    p.queue_since
  FROM pagina p
  JOIN public.whatsapp_contacts ct ON ct.id = (p.conv).contact_id
  ORDER BY p.queue_since ASC;
$function$;

COMMENT ON FUNCTION public.whatsapp_list_queue IS
  'DEM-0227: lista da pill "Fila" em ordem FIFO de chegada, paginada NO SERVIDOR. '
  'Varre support_attendances (status=waiting) em vez de whatsapp_conversations — '
  'ordenar so no cliente cortaria justamente quem espera ha mais tempo. '
  'Chegada = COALESCE(awaiting_agent_since, queued_at, opened_at).';

REVOKE ALL ON FUNCTION public.whatsapp_list_queue(
  uuid, uuid, uuid, uuid[], text, boolean, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_list_queue(
  uuid, uuid, uuid, uuid[], text, boolean, integer, integer
) TO authenticated, service_role;
