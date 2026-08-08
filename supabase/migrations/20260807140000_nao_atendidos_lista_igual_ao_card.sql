-- DEM-0153 (2ª volta) — a lista do card "Não Atendido" passa a ter EXATAMENTE
-- os atendimentos que o card conta.
--
-- Antes: o card contava `assumed_at IS NULL` (ex.: 78) e a lista mostrava só o
-- subconjunto "vácuo" (sem nenhuma resposta de agente e sem ticket). Quem clicava
-- via menos linhas do que o número do card e não tinha como conferir a diferença —
-- só um texto de reconciliação explicando o buraco.
--
-- Agora: lista = `assumed_at IS NULL`, e cada chat carrega o `motivo` de não ter
-- sido assumido. Os totais por motivo continuam saindo separados para o resumo.
--
-- A CTE `base` NÃO foi tocada: continua cópia literal da de
-- get_atendimento_velocidade (que não está versionada — vive só no banco).
-- Se divergir, a lista deixa de bater com o card e não há como o usuário saber
-- qual dos dois está certo.
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
  nao_assumidos AS (
    -- O conjunto do card, inteiro. O motivo separa o que antes era "vácuo" do
    -- resto: 'ticket' vem primeiro porque encaminhar para ticket é o desfecho —
    -- mesmo que uma mensagem tenha saído antes disso.
    SELECT b.*,
           CASE
             WHEN b.ticket_id IS NOT NULL OR b.created_from = 'ticket' THEN 'ticket'
             WHEN b.msg_agent_count > 0                                THEN 'respondido'
             ELSE 'sem_resposta'
           END AS motivo
    FROM base b
    WHERE b.assumed_at IS NULL
  ),
  chats AS (
    SELECT n.*,
           COALESCE(n.contact_id::text, n.contact_phone, n.id::text) AS grp,
           sd.name AS departamento,
           COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') AS cliente_nome,
           GREATEST(EXTRACT(EPOCH FROM (COALESCE(n.closed_at, now()) - n.opened_at))::int, 0) AS aberto_seg
    FROM nao_assumidos n
    LEFT JOIN support_departments sd ON sd.id = n.department_id
    LEFT JOIN clientes c            ON c.id  = n.cliente_id
  ),
  agrupado AS (
    SELECT grp,
           (array_agg(COALESCE(contact_name, contact_phone, 'Sem nome') ORDER BY opened_at DESC))[1] AS contato,
           (array_agg(contact_phone ORDER BY opened_at DESC))[1] AS telefone,
           (array_agg(cliente_id   ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_id,
           (array_agg(cliente_nome ORDER BY (cliente_id IS NULL), opened_at DESC))[1] AS cliente_nome,
           count(*)::int  AS qtd,
           count(*) FILTER (WHERE motivo = 'sem_resposta')::int AS qtd_sem_resposta,
           max(opened_at) AS ultimo_at,
           jsonb_agg(jsonb_build_object(
             'attendance_id',      id,
             'attendance_code',    attendance_code,
             'conversation_id',    conversation_id,
             'opened_at',          opened_at,
             'closed_at',          closed_at,
             'departamento',       departamento,
             'msg_customer_count', msg_customer_count,
             'msg_agent_count',    msg_agent_count,
             'motivo',             motivo,
             'aberto_seg',         aberto_seg
           ) ORDER BY opened_at DESC) AS chats
    FROM chats
    GROUP BY grp
  )
  SELECT jsonb_build_object(
    -- total_card = o número do card. A lista agora cobre esse conjunto inteiro.
    'total_card',         (SELECT count(*) FROM nao_assumidos),
    'total_sem_resposta', (SELECT count(*) FROM nao_assumidos WHERE motivo = 'sem_resposta'),
    'total_respondido',   (SELECT count(*) FROM nao_assumidos WHERE motivo = 'respondido'),
    'total_ticket',       (SELECT count(*) FROM nao_assumidos WHERE motivo = 'ticket'),
    'total_chats',        (SELECT count(*) FROM nao_assumidos),
    'total_contatos',     (SELECT count(*) FROM agrupado),
    'truncado',           (SELECT count(*) FROM agrupado) > p_limit,
    'contatos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'contato',          a.contato,
               'telefone',         a.telefone,
               'cliente_id',       a.cliente_id,
               'cliente_nome',     CASE WHEN a.cliente_id IS NULL THEN NULL ELSE a.cliente_nome END,
               'qtd',              a.qtd,
               'qtd_sem_resposta', a.qtd_sem_resposta,
               'ultimo_at',        a.ultimo_at,
               'chats',            a.chats
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
