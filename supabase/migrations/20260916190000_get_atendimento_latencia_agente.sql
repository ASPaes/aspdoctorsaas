-- DEM-0364 · Drill-down da latência na aba Agentes.
--
-- O scorecard mostra a mediana de latência do agente; esta função mostra as
-- RESPOSTAS que a formaram, uma por linha, da maior para a menor.
--
-- Três decisões, todas herdadas de `get_atendimento_agentes`:
--
-- 1. A linha é uma RESPOSTA, não um atendimento. A latência nasce em
--    `whatsapp_messages`, casando bloco do cliente -> primeiro bloco do agente
--    seguinte, e nunca passa por `support_attendances`. Listar por atendimento
--    daria outro número e a tela deixaria de fechar com o card.
--
-- 2. O recorte é o mesmo do scorecard: só `p_is_group` e `p_plantao` filtram —
--    `p_department_id` e a unidade NÃO entram, porque não entram lá. O plantão
--    é avaliado no INSTANTE da resposta, via `fn_instante_fora_expediente`.
--
-- 3. `kpi_cap_seconds('latencia')` (4h) corta o outlier da mediana, mas ele não
--    é escondido: vem com `no_calculo = false`. São os piores casos, e é para
--    caçá-los que a lista existe — mesmo contrato da `get_atendimento_velocidade_lista`.
--
-- A CTE `convs` é o que segura o custo: em vez de varrer as mensagens do tenant
-- inteiro no período, restringe às conversas em que ESTE agente falou (usa
-- `idx_whatsapp_messages_sent_by_user_id`). Bloco de agente fora dessas
-- conversas não existe, então o recorte é idêntico e o scan é uma fração.
CREATE OR REPLACE FUNCTION public.get_atendimento_latencia_agente(
  p_tenant_id uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz,
  p_agent_id  uuid,
  p_is_group  boolean DEFAULT NULL,
  p_plantao   text    DEFAULT NULL,
  p_limit     integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_cap    int;
  v_result jsonb;
BEGIN
  IF p_tenant_id IS NOT NULL AND public.is_super_admin() THEN
    v_tenant := p_tenant_id;
  ELSE
    v_tenant := public.current_tenant_id();
  END IF;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Tenant não identificado'; END IF;

  IF p_agent_id IS NULL THEN
    RAISE EXCEPTION 'p_agent_id é obrigatório';
  END IF;

  IF p_plantao IS NOT NULL AND p_plantao NOT IN ('plantao','comercial') THEN
    RAISE EXCEPTION 'p_plantao inválido: % (use plantao, comercial ou NULL)', p_plantao;
  END IF;

  v_cap := public.kpi_cap_seconds('latencia');

  WITH convs AS (
    SELECT DISTINCT m.conversation_id
    FROM whatsapp_messages m
    WHERE m.tenant_id = v_tenant
      AND m.sent_by_user_id = p_agent_id
      AND m.timestamp >= p_date_from AND m.timestamp <= p_date_to
      AND m.deleted_at IS NULL
  ),
  msg_flag AS (
    SELECT m.conversation_id, m.sent_by_user_id, m.is_from_me, m.timestamp,
           m.content, m.message_type, m.media_kind,
           CASE WHEN LAG(m.is_from_me) OVER w IS DISTINCT FROM m.is_from_me THEN 1 ELSE 0 END AS new_block
    FROM whatsapp_messages m
    JOIN convs cv ON cv.conversation_id = m.conversation_id
    WHERE m.tenant_id = v_tenant
      AND m.timestamp >= p_date_from AND m.timestamp <= p_date_to
      AND m.deleted_at IS NULL
    WINDOW w AS (PARTITION BY m.conversation_id ORDER BY m.timestamp)
  ),
  msg_blk AS (
    SELECT conversation_id, sent_by_user_id, is_from_me, timestamp,
           content, message_type, media_kind,
           SUM(new_block) OVER (PARTITION BY conversation_id ORDER BY timestamp) AS block_id
    FROM msg_flag
  ),
  lat_cli AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS cli_first,
           (array_agg(
              left(COALESCE(
                     NULLIF(btrim(content), ''),
                     '[' || COALESCE(media_kind, message_type) || ']'
                   ), 160)
              ORDER BY timestamp))[1] AS cli_preview
    FROM msg_blk WHERE is_from_me = false GROUP BY conversation_id, block_id
  ),
  lat_agt AS (
    SELECT conversation_id, block_id, MIN(timestamp) AS agt_first,
           (array_agg(sent_by_user_id ORDER BY timestamp) FILTER (WHERE sent_by_user_id IS NOT NULL))[1] AS agente
    FROM msg_blk WHERE is_from_me = true AND sent_by_user_id IS NOT NULL GROUP BY conversation_id, block_id
  ),
  -- Sem o teto aqui: ele vira a marca `no_calculo`, para a lista poder mostrar
  -- o que ficou de fora do percentil.
  lat_gap AS (
    SELECT c.conversation_id,
           c.cli_first,
           c.cli_preview,
           a.agt_first,
           EXTRACT(EPOCH FROM (a.agt_first - c.cli_first))::int AS seg,
           COALESCE(wc.is_group, false) AS is_group,
           wc.department_id,
           wc.contact_id
    FROM lat_cli c
    JOIN lat_agt a ON a.conversation_id = c.conversation_id AND a.block_id = c.block_id + 1
    JOIN whatsapp_conversations wc ON wc.id = c.conversation_id
    WHERE a.agente = p_agent_id
      AND (p_is_group IS NULL OR COALESCE(wc.is_group, false) = p_is_group)
      AND EXTRACT(EPOCH FROM (a.agt_first - c.cli_first)) >= 1
      AND (p_plantao IS NULL
           OR (p_plantao = 'plantao')
              = public.fn_instante_fora_expediente(v_tenant, wc.department_id, a.agt_first))
  ),
  itens AS (
    SELECT g.*,
           (g.seg <= v_cap) AS no_calculo,
           width_bucket(g.seg, ARRAY[30,60,120,300,600,1800]) AS faixa_idx,
           COALESCE(ct.name, ct.phone_number, 'Sem nome') AS contato,
           ct.cliente_id,
           COALESCE(cl.nome_fantasia, cl.razao_social) AS cliente_nome,
           sd.name AS departamento
    FROM lat_gap g
    LEFT JOIN whatsapp_contacts   ct ON ct.id = g.contact_id
    LEFT JOIN clientes            cl ON cl.id = ct.cliente_id
    LEFT JOIN support_departments sd ON sd.id = g.department_id
  )
  SELECT jsonb_build_object(
    'agent_id',    p_agent_id,
    'nome',        (SELECT f.nome FROM profiles p
                      LEFT JOIN funcionarios f ON f.id = p.funcionario_id
                     WHERE p.user_id = p_agent_id AND p.tenant_id = v_tenant),
    'cap_seconds', v_cap,
    'total_lista',      (SELECT count(*) FROM itens),
    'total_no_calculo', (SELECT count(*) FROM itens WHERE no_calculo),
    'total_fora_cap',   (SELECT count(*) FROM itens WHERE NOT no_calculo),
    'total_conversas',  (SELECT count(DISTINCT conversation_id) FROM itens),
    'p50', (SELECT ROUND(percentile_cont(0.5) WITHIN GROUP (ORDER BY seg))::int FROM itens WHERE no_calculo),
    'p90', (SELECT ROUND(percentile_cont(0.9) WITHIN GROUP (ORDER BY seg))::int FROM itens WHERE no_calculo),
    'truncado', (SELECT count(*) FROM itens) > p_limit,
    -- As 7 faixas do histograma da aba, sempre todas, mesmo zeradas.
    'faixas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'idx',   f.idx,
               'faixa', (ARRAY['<30s','30s-1min','1-2min','2-5min','5-10min','10-30min','30min+'])[f.idx + 1],
               'qtd',   (SELECT count(*) FROM itens i WHERE i.no_calculo AND i.faixa_idx = f.idx)
             ) ORDER BY f.idx)
      FROM generate_series(0, 6) AS f(idx)), '[]'::jsonb),
    'itens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'conversation_id', a.conversation_id,
               'cli_first',       a.cli_first,
               'agt_first',       a.agt_first,
               'preview',         a.cli_preview,
               'contato',         a.contato,
               'cliente_id',      a.cliente_id,
               'cliente_nome',    a.cliente_nome,
               'departamento',    a.departamento,
               'is_group',        a.is_group,
               'seg',             a.seg,
               'no_calculo',      a.no_calculo
             ) ORDER BY a.seg DESC, a.cli_first DESC)
      FROM (SELECT * FROM itens ORDER BY seg DESC, cli_first DESC LIMIT p_limit) a
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_atendimento_latencia_agente(
  uuid, timestamptz, timestamptz, uuid, boolean, text, integer
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_atendimento_latencia_agente(
  uuid, timestamptz, timestamptz, uuid, boolean, text, integer
) TO authenticated, service_role;
