-- A lista do card "Não Atendido" tem que mostrar o mesmo conjunto do card.
-- Com o card virando "vácuo de verdade" (sem assumir + sem ticket + sem
-- mensagem do time), a CTE nao_assumidos passa a aplicar o mesmo filtro.
-- Os recortes 'respondido' e 'ticket' saem por definição — ficam zerados, e o
-- resumo do diálogo some sozinho (só aparece com 2+ recortes > 0).
CREATE OR REPLACE FUNCTION public.get_atendimento_nao_atendidos(p_tenant_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_department_id uuid DEFAULT NULL::uuid, p_unidade_base_id bigint DEFAULT NULL::bigint, p_agent_id uuid DEFAULT NULL::uuid, p_is_group boolean DEFAULT NULL::boolean, p_limit integer DEFAULT 200, p_plantao text DEFAULT NULL::text)
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

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

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
      AND sa.status = 'closed' AND sa.closed_reason IS DISTINCT FROM 'ura_autoatendimento'
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_agent_id IS NULL OR sa.assigned_to = p_agent_id)
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
  ),
  nao_assumidos AS (
    -- O conjunto do card, inteiro: vácuo de verdade. Ninguém assumiu, ninguém
    -- respondeu e não virou ticket. Responder pelo próprio WhatsApp não grava
    -- assumed_at — por isso o filtro é por msg_agent_count, não por assumed_at
    -- sozinho. `motivo` fica só para o rótulo da linha.
    SELECT b.*, 'sem_resposta'::text AS motivo
    FROM base b
    WHERE b.assumed_at IS NULL
      AND b.ticket_id IS NULL
      AND b.created_from <> 'ticket'
      AND b.msg_agent_count = 0
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
    'total_card',         (SELECT count(*) FROM nao_assumidos),
    'total_sem_resposta', (SELECT count(*) FROM nao_assumidos WHERE motivo = 'sem_resposta'),
    'total_respondido',   0,
    'total_ticket',       0,
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
