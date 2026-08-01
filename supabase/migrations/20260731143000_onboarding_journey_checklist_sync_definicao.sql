-- Checklist da jornada: a definição passa a acompanhar o cadastro.
--
-- Antes, sync_journey_stage_checklist só INSERIA os itens que faltavam. O snapshot
-- em onboarding_journey_checklist congelava texto, obrigatoriedade, ordem e nome do
-- grupo no instante em que a jornada entrou na etapa — desmarcar "obrigatório" no
-- cadastro não chegava em nenhum cartão já existente, nem com F5.
--
-- Regra: definição (texto, is_required, position, grupo) é do CADASTRO;
--        estado (done, done_at, done_by) é da JORNADA.
-- Item manual (origem <> 'etapa') e item que saiu do cadastro ficam intocados.
CREATE OR REPLACE FUNCTION public.sync_journey_stage_checklist(p_journey_id uuid, p_stage_id uuid)
 RETURNS SETOF onboarding_journey_checklist
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.onboarding_journeys WHERE id = p_journey_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'jornada nao encontrada'; END IF;
  IF NOT public.can_access_tenant_row(v_tenant) THEN RAISE EXCEPTION 'sem permissao'; END IF;

  INSERT INTO public.onboarding_journey_checklist
    (tenant_id, journey_id, stage_id, grupo_nome, grupo_pos, texto, is_required, position, origem, source_item_id)
  SELECT v_tenant, p_journey_id, c.stage_id, g.nome, COALESCE(g.position, 0),
         c.texto, c.is_required, c.position, 'etapa', c.id
  FROM public.onboarding_stage_checklist c
  LEFT JOIN public.onboarding_stage_checklist_groups g ON g.id = c.group_id
  WHERE c.stage_id = p_stage_id AND c.ativo
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
