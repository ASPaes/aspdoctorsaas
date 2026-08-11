-- Sync do checklist da jornada respeitando o vínculo por tipo de demanda (11/08/2026).
-- Três mudanças sobre a versão de 31/07: lê o demand_type_id da jornada, apaga do snapshot
-- o que deixou de valer (só o não marcado) e filtra o INSERT. O UPDATE de reespelho não muda.

CREATE OR REPLACE FUNCTION public.sync_journey_stage_checklist(p_journey_id uuid, p_stage_id uuid)
 RETURNS SETOF onboarding_journey_checklist
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_demand uuid;
BEGIN
  SELECT tenant_id, demand_type_id INTO v_tenant, v_demand
    FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  -- Grupo que deixou de valer para a demanda sai do card. Item já marcado FICA:
  -- é o registro de que alguém fez aquilo. Item criado à mão (origem <> 'etapa') nunca é tocado.
  DELETE FROM public.onboarding_journey_checklist jc
   USING public.onboarding_stage_checklist c
   WHERE jc.journey_id = p_journey_id
     AND jc.stage_id = p_stage_id
     AND jc.origem = 'etapa'
     AND jc.done = false
     AND jc.source_item_id = c.id
     AND NOT public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand);

  INSERT INTO public.onboarding_journey_checklist
    (tenant_id, journey_id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem, source_item_id)
  SELECT v_tenant, p_journey_id, c.stage_id, g.nome, COALESCE(g.position, 0),
         c.texto, c.is_required, c.position, 'etapa', c.id
  FROM public.onboarding_stage_checklist c
  LEFT JOIN public.onboarding_stage_checklist_groups g ON g.id = c.group_id
  WHERE c.stage_id = p_stage_id AND c.ativo
    AND public.fn_onb_checklist_grupo_aplica(c.group_id, v_demand)
    AND NOT EXISTS (
      SELECT 1 FROM public.onboarding_journey_checklist jc
      WHERE jc.journey_id = p_journey_id AND jc.source_item_id = c.id
    );

  -- Reespelha o que mudou no cadastro. O IS DISTINCT FROM evita escrita à toa:
  -- no caso normal (nada mudou) o UPDATE não toca em nenhuma linha.
  UPDATE public.onboarding_journey_checklist jc
     SET grupo_nome  = g.nome,
         grupo_pos   = COALESCE(g.position, 0),
         texto       = c.texto,
         is_required = c.is_required,
         position    = c.position
  FROM public.onboarding_stage_checklist c
  LEFT JOIN public.onboarding_stage_checklist_groups g ON g.id = c.group_id
  WHERE jc.journey_id = p_journey_id
    AND jc.origem = 'etapa'
    AND jc.source_item_id = c.id
    AND c.stage_id = p_stage_id
    AND c.ativo
    AND (   jc.grupo_nome  IS DISTINCT FROM g.nome
         OR jc.grupo_pos   IS DISTINCT FROM COALESCE(g.position, 0)
         OR jc.texto       IS DISTINCT FROM c.texto
         OR jc.is_required IS DISTINCT FROM c.is_required
         OR jc.position    IS DISTINCT FROM c.position);

  RETURN QUERY
    SELECT * FROM public.onboarding_journey_checklist
    WHERE journey_id = p_journey_id AND stage_id = p_stage_id
    ORDER BY grupo_pos, position, created_at;
END $function$;
