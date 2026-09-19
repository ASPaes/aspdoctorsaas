-- DEM-0315 (pendência 2): clicar numa célula do quadro Agente × Categoria abre
-- os chats que formaram aquele número.
--
-- Função NOVA em vez de reusar get_atendimento_chats_lista: o recorte da lista
-- é mais largo que o do scorecard (conta atendimento sem mensagem do cliente,
-- agendamento futuro e sem agente), e a lista tem que fechar com a célula.
-- O WHERE abaixo é CÓPIA do CTE `base` de get_atendimento_agentes (produção,
-- 18/09/2026, já com a opção "Sem categoria"), mais o agente fixo. Mudou lá,
-- muda aqui.
--
-- Ordem: maior duração primeiro — o gestor quer achar o chat que puxou o TMA.
-- `no_calculo` marca o que entra na mediana (dentro do teto do TMA), como o
-- detalhe de latência faz.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_atendimento_agente_categoria_chats(
  p_tenant_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz,
  p_agent_id uuid,
  p_department_id uuid DEFAULT NULL,
  p_unidade_base_id bigint DEFAULT NULL,
  p_is_group boolean DEFAULT NULL,
  p_plantao text DEFAULT NULL,
  p_category_ids uuid[] DEFAULT NULL,
  p_subcategory_ids uuid[] DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unids bigint[];
  v_tenant uuid;
  v_cap int;
  v_result jsonb;
  v_filtra_cat boolean := COALESCE(array_length(p_category_ids,1),0) > 0
                       OR COALESCE(array_length(p_subcategory_ids,1),0) > 0;
  -- O UUID nulo dentro de p_category_ids é a opção "Sem categoria".
  v_sem_cat boolean := '00000000-0000-0000-0000-000000000000'::uuid = ANY(COALESCE(p_category_ids, '{}'::uuid[]));
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN v_tenant := p_tenant_id;
  ELSE v_tenant := public.current_tenant_id(); END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;
  IF p_agent_id IS NULL THEN RAISE EXCEPTION 'p_agent_id é obrigatório'; END IF;
  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_unids := public.user_effective_unidades();
  v_cap := public.kpi_cap_seconds('tma');

  WITH base AS (
    SELECT sa.id, sa.attendance_code, sa.conversation_id, sa.contact_name, sa.contact_phone,
           sa.cliente_id, sa.opened_at, sa.closed_at, sa.handle_seconds, sa.ticket_id,
           COALESCE(sa.is_group, false) AS is_group
    FROM support_attendances sa
    WHERE sa.tenant_id = v_tenant
      AND sa.opened_at >= p_date_from AND sa.opened_at <= p_date_to
      AND (sa.scheduled_until IS NULL OR sa.scheduled_until <= now())
      AND (sa.msg_customer_count > 0 OR sa.last_customer_message_at IS NOT NULL)
      AND (p_department_id IS NULL OR sa.department_id = p_department_id)
      AND (p_unidade_base_id IS NULL OR sa.unidade_base_id = p_unidade_base_id)
      AND (v_unids IS NULL OR sa.unidade_base_id IS NULL OR sa.unidade_base_id = ANY(v_unids))
      AND (p_is_group IS NULL OR COALESCE(sa.is_group, false) = p_is_group)
      AND (p_plantao IS NULL OR (p_plantao = 'plantao') = COALESCE(sa.plantao, false))
      AND (NOT v_filtra_cat
           OR (v_sem_cat AND NOT EXISTS (
                 SELECT 1 FROM support_tickets tk
                 WHERE tk.id = sa.ticket_id AND tk.category_id IS NOT NULL))
           OR EXISTS (
            SELECT 1 FROM support_tickets tk
            WHERE tk.id = sa.ticket_id
              AND (COALESCE(array_length(p_category_ids,1),0)=0 OR tk.category_id = ANY(p_category_ids))
              AND (COALESCE(array_length(p_subcategory_ids,1),0)=0 OR tk.subcategory_id = ANY(p_subcategory_ids))))
      AND sa.assigned_to = p_agent_id
  ),
  itens AS (
    SELECT b.*,
           (b.handle_seconds BETWEEN 1 AND v_cap) AS no_calculo,
           tsc.nome AS categoria,
           tss.nome AS subcategoria
    FROM base b
    LEFT JOIN support_tickets tk        ON tk.id = b.ticket_id
    LEFT JOIN service_categories tsc    ON tsc.id = tk.category_id
    LEFT JOIN service_subcategories tss ON tss.id = tk.subcategory_id
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM itens),
    'tma_p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY handle_seconds))::int
                  FROM itens WHERE no_calculo),
    'truncado', (SELECT count(*) FROM itens) > p_limit,
    'por_subcategoria', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('subcategoria', s.subcategoria, 'qtd', s.qtd) ORDER BY s.qtd DESC)
      FROM (SELECT subcategoria, count(*) AS qtd FROM itens WHERE subcategoria IS NOT NULL GROUP BY subcategoria) s
    ), '[]'::jsonb),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'attendance_id',   a.id,
               'attendance_code', a.attendance_code,
               'conversation_id', a.conversation_id,
               'contato',         COALESCE(NULLIF(a.contact_name,''), a.contact_phone, 'Sem nome'),
               'cliente_nome',    CASE WHEN a.cliente_id IS NULL THEN NULL
                                       ELSE COALESCE(c.nome_fantasia, c.razao_social, '(sem nome)') END,
               'opened_at',       a.opened_at,
               'closed_at',       a.closed_at,
               'handle_seconds',  a.handle_seconds,
               'no_calculo',      a.no_calculo,
               'categoria',       a.categoria,
               'subcategoria',    a.subcategoria,
               'is_group',        a.is_group
             ) ORDER BY a.handle_seconds DESC NULLS LAST, a.opened_at DESC)
      FROM (SELECT * FROM itens ORDER BY handle_seconds DESC NULLS LAST, opened_at DESC LIMIT p_limit) a
      LEFT JOIN clientes c ON c.id = a.cliente_id
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_atendimento_agente_categoria_chats(uuid, timestamptz, timestamptz, uuid, uuid, bigint, boolean, text, uuid[], uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_atendimento_agente_categoria_chats(uuid, timestamptz, timestamptz, uuid, uuid, bigint, boolean, text, uuid[], uuid[], integer) TO authenticated, service_role;

COMMIT;
