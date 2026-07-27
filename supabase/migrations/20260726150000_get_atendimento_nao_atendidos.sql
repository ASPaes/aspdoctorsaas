-- DEM-0153 — drill-down do card "Não Atendido" (Atendimento → Velocidade / SLA).
-- A CTE `base` é cópia literal da de get_atendimento_velocidade: se divergir, a lista
-- deixa de bater com o card e não há como o usuário saber qual dos dois está certo.
CREATE OR REPLACE FUNCTION public.get_atendimento_nao_atendidos(
  p_tenant_id       uuid,
  p_date_from       timestamptz,
  p_date_to         timestamptz,
  p_department_id   uuid    DEFAULT NULL,
  p_unidade_base_id bigint  DEFAULT NULL,
  p_agent_id        uuid    DEFAULT NULL,
  p_is_group        boolean DEFAULT NULL,
  p_limit           int     DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_unids  bigint[];
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  v_unids := public.user_effective_unidades();

  WITH base AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id, sa.contact_id,
           sa.contact_name, sa.contact_phone, sa.cliente_id, sa.department_id,
           sa.opened_at, sa.closed_at, sa.assumed_at,
           sa.ticket_id, COALESCE(sa.created_from, '') AS created_from,
           COALESCE(sa.msg_agent_count, 0)    AS msg_agent_count,
           COALESCE(sa.msg_customer_count, 0) AS msg_customer_count
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND sa.status = 'closed'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
  ),
  vacuo AS (
    -- Vácuo = ninguém assumiu, ninguém respondeu E o caso não foi encaminhado.
    -- O ticket é o que separa "abandonado" de "tratado por outro caminho": o cliente
    -- escreveu, só a saudação automática respondeu, mas alguém converteu em ticket.
    -- Mesma regra que o fechamento já usa (ticket_id / created_from='ticket').
    SELECT * FROM base
     WHERE assumed_at IS NULL
       AND msg_agent_count = 0
       AND ticket_id IS NULL
       AND created_from <> 'ticket'
  ),
  chats AS (
    SELECT v.*,
           COALESCE(v.contact_id::text, v.contact_phone, v.id::text) AS grp,
           sd.name AS departamento,
           COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') AS cliente_nome,
           GREATEST(EXTRACT(EPOCH FROM (COALESCE(v.closed_at, now()) - v.opened_at))::int, 0) AS aberto_seg
    FROM vacuo v
    LEFT JOIN support_departments sd ON sd.id = v.department_id
    LEFT JOIN clientes c            ON c.id  = v.cliente_id
  ),
  agrupado AS (
    SELECT grp,
           (array_agg(COALESCE(contact_name, contact_phone, 'Sem nome') ORDER BY opened_at DESC))[1] AS contato,
           (array_agg(contact_phone ORDER BY opened_at DESC))[1] AS telefone,
           (array_agg(cliente_id   ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_id,
           (array_agg(cliente_nome ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_nome,
           count(*)::int  AS qtd,
           max(opened_at) AS ultimo_at,
           jsonb_agg(jsonb_build_object(
             'attendance_id',      id,
             'attendance_code',    attendance_code,
             'conversation_id',    conversation_id,
             'opened_at',          opened_at,
             'closed_at',          closed_at,
             'departamento',       departamento,
             'msg_customer_count', msg_customer_count,
             'aberto_seg',         aberto_seg
           ) ORDER BY opened_at DESC) AS chats
    FROM chats
    GROUP BY grp
  )
  SELECT jsonb_build_object(
    'total_sem_resposta', (SELECT count(*) FROM vacuo),
    'total_card',         (SELECT count(*) FROM base WHERE assumed_at IS NULL),
    'total_contatos',     (SELECT count(*) FROM agrupado),
    'truncado',           (SELECT count(*) FROM agrupado) > p_limit,
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contato',      a.contato,
               'telefone',     a.telefone,
               'cliente_id',   a.cliente_id,
               'cliente_nome', CASE WHEN a.cliente_id IS NULL THEN NULL ELSE a.cliente_nome END,
               'qtd',          a.qtd,
               'ultimo_at',    a.ultimo_at,
               'chats',        a.chats
             ) ORDER BY a.qtd DESC, a.ultimo_at DESC)
      FROM (SELECT * FROM agrupado ORDER BY qtd DESC, ultimo_at DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_atendimento_nao_atendidos(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, boolean, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_atendimento_nao_atendidos(
  uuid, timestamptz, timestamptz, uuid, bigint, uuid, boolean, int) TO authenticated, service_role;
