-- Régua da Jornada: plano (SLA da etapa) contra realizado (histórico em horário útil),
-- do início ao fim do trilho, agregado POR ETAPA.
-- Em 01/08 havia 23 pares (jornada, etapa) com mais de uma passagem, até 3 na mesma
-- etapa: sem agregar, a régua desenha a mesma etapa três vezes e o total não fecha.

-- ── backfill: linhas fechadas antes do fix de 26/07 estão sem duração útil e
--    renderizariam com largura zero. (As novas já nascem preenchidas — ver
--    20260802102000, que fechou o furo em advance_onboarding_to_implantacao.)
UPDATE public.onboarding_stage_history h
   SET duracao_util_minutos = public.fn_onb_util_min(
         h.entrou_em, h.saiu_em, h.tenant_id,
         (SELECT COALESCE(p.department_id, t.department_id)
            FROM public.onboarding_stages s
            JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
            JOIN public.onboarding_journeys j  ON j.id = h.journey_id
            LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
           WHERE s.id = h.stage_id))
 WHERE h.saiu_em IS NOT NULL AND h.duracao_util_minutos IS NULL;

CREATE OR REPLACE FUNCTION public.get_journey_ruler(p_journey_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_res jsonb;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RETURN NULL; END IF;
  PERFORM public.assert_tenant_scope(v_tenant);

  WITH pipes AS (
    -- O trilho REAL desta jornada: os pipelines a que ela está presa, mais qualquer um
    -- por onde o cartão passou (a fase de Acompanhamento é resolvida depois da criação
    -- e não fica gravada na tabela da jornada).
    SELECT DISTINCT pid FROM (
      SELECT j.pipeline_onboarding_id  AS pid FROM public.onboarding_journeys j WHERE j.id = p_journey_id
      UNION ALL
      SELECT j.pipeline_implantacao_id FROM public.onboarding_journeys j WHERE j.id = p_journey_id
      UNION ALL
      SELECT s.pipeline_id FROM public.onboarding_journeys j
        JOIN public.onboarding_stages s ON s.id = j.current_stage_id WHERE j.id = p_journey_id
      UNION ALL
      SELECT s.pipeline_id FROM public.onboarding_stage_history h
        JOIN public.onboarding_stages s ON s.id = h.stage_id WHERE h.journey_id = p_journey_id
    ) u WHERE pid IS NOT NULL
  ), etapas AS (
    -- Etapa inativa que aparece no histórico entra: senão a régua perde um pedaço do passado.
    SELECT s.id, s.nome, s.sla_minutos,
           COALESCE(s.inicia_sla,false)  AS inicia,
           COALESCE(s.encerra_sla,false) AS encerra,
           COALESCE(ph.nome, p.fase::text) AS fase,
           public.fn_onb_stage_ordem(s.id) AS ordem,
           COALESCE(p.department_id, t.department_id) AS dept
      FROM public.onboarding_stages s
      JOIN pipes ON pipes.pid = s.pipeline_id
      JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
      LEFT JOIN public.onboarding_phases ph ON ph.id = p.phase_id
      LEFT JOIN public.onboarding_journeys j ON j.id = p_journey_id
      LEFT JOIN public.support_tickets t ON t.id = j.ticket_id
     WHERE s.ativo
        OR EXISTS (SELECT 1 FROM public.onboarding_stage_history h
                    WHERE h.journey_id = p_journey_id AND h.stage_id = s.id)
  ), real_por_etapa AS (
    SELECT h.stage_id,
           count(*)::int AS passagens,
           bool_or(h.saiu_em IS NULL) AS aberta,
           COALESCE(sum(
             CASE WHEN h.saiu_em IS NULL
                  THEN public.fn_onb_util_min(h.entrou_em, now(), h.tenant_id, e.dept)
                  ELSE COALESCE(h.duracao_util_minutos, 0) END), 0)::int AS real_min
      FROM public.onboarding_stage_history h
      JOIN etapas e ON e.id = h.stage_id
     WHERE h.journey_id = p_journey_id
     GROUP BY h.stage_id
  ), janela AS (
    SELECT COALESCE(min(ordem) FILTER (WHERE inicia),  min(ordem)) AS ini,
           COALESCE(min(ordem) FILTER (WHERE encerra), max(ordem)) AS fim
      FROM etapas
  )
  SELECT jsonb_agg(x ORDER BY ord) INTO v_res
    FROM (
      SELECT e.ordem AS ord,
             jsonb_build_object(
               'stage_id',    e.id,
               'nome',        e.nome,
               'fase',        e.fase,
               'ordem',       e.ordem,
               'plano_min',   COALESCE(e.sla_minutos, 0),
               'real_min',    COALESCE(r.real_min, 0),
               'passagens',   COALESCE(r.passagens, 0),
               'aberta',      COALESCE(r.aberta, false),
               'inicia',      e.inicia,
               'encerra',     e.encerra,
               'fora_janela', (e.ordem < j.ini OR e.ordem > j.fim)
             ) AS x
        FROM etapas e
        CROSS JOIN janela j
        LEFT JOIN real_por_etapa r ON r.stage_id = e.id
    ) s;

  RETURN COALESCE(v_res, '[]'::jsonb);
END $function$;

REVOKE ALL ON FUNCTION public.get_journey_ruler(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_journey_ruler(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_journey_ruler(uuid) IS
  'Régua da jornada: plano x realizado por etapa do trilho, agregado por etapa (revisitas viram passagens).';
