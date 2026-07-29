-- Entrega A / Task 5 — a linha da fase nasce quando a fase abre, não quando fecha.
-- Nenhuma RPC é alterada: o trigger reage ao que elas já escrevem em fase_atual,
-- que o trigger BEFORE (Task 4) converte em current_phase_id.
--
-- CUIDADO: o trigger NÃO pode usar `AFTER UPDATE OF current_phase_id`. A cláusula OF
-- olha as colunas do SET do comando, e nenhuma RPC de hoje escreve current_phase_id
-- (quem preenche é o trigger BEFORE). Com OF, o trigger nunca dispararia.

CREATE OR REPLACE FUNCTION public.fn_open_onboarding_phase_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pipeline uuid; v_now timestamptz := now();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.current_phase_id IS NOT DISTINCT FROM OLD.current_phase_id THEN
    RETURN NEW;
  END IF;

  -- fecha qualquer fase que tenha ficado aberta e não seja a atual
  UPDATE public.onboarding_phase_metrics
     SET concluida_em = v_now
   WHERE journey_id = NEW.id
     AND concluida_em IS NULL
     AND phase_id IS DISTINCT FROM NEW.current_phase_id;

  IF NEW.current_phase_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- pipeline dessa fase percorrido pela jornada: o da etapa atual, senão o primeiro ativo
  SELECT s.pipeline_id INTO v_pipeline
    FROM public.onboarding_stages s
    JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
   WHERE s.id = NEW.current_stage_id AND p.phase_id = NEW.current_phase_id;

  IF v_pipeline IS NULL THEN
    SELECT p.id INTO v_pipeline FROM public.onboarding_pipelines p
     WHERE p.tenant_id = NEW.tenant_id AND p.phase_id = NEW.current_phase_id AND p.ativo
     ORDER BY (p.produto_id = NEW.produto_id) DESC NULLS LAST, p.position LIMIT 1;
  END IF;

  INSERT INTO public.onboarding_phase_metrics
    (tenant_id, journey_id, phase_id, pipeline_id, iniciada_em, responsavel_user_id)
  VALUES (NEW.tenant_id, NEW.id, NEW.current_phase_id, v_pipeline, v_now, NEW.responsavel_user_id)
  ON CONFLICT (journey_id, phase_id) DO UPDATE
    SET pipeline_id  = COALESCE(public.onboarding_phase_metrics.pipeline_id, EXCLUDED.pipeline_id),
        iniciada_em  = COALESCE(public.onboarding_phase_metrics.iniciada_em, EXCLUDED.iniciada_em),
        concluida_em = NULL;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_open_onb_phase_row ON public.onboarding_journeys;
CREATE TRIGGER trg_open_onb_phase_row
  AFTER INSERT OR UPDATE ON public.onboarding_journeys
  FOR EACH ROW EXECUTE FUNCTION public.fn_open_onboarding_phase_row();

-- ---------------------------------------------------------------- backfill
-- Fases já percorridas e fechadas já existem (fn_snapshot_onboarding_phase);
-- o que nunca existiu é a linha da fase atualmente ABERTA de cada jornada viva.
INSERT INTO public.onboarding_phase_metrics
  (tenant_id, journey_id, phase_id, pipeline_id, iniciada_em, responsavel_user_id)
SELECT j.tenant_id, j.id, j.current_phase_id,
       COALESCE(
         (SELECT s.pipeline_id FROM public.onboarding_stages s
            JOIN public.onboarding_pipelines p ON p.id = s.pipeline_id
           WHERE s.id = j.current_stage_id AND p.phase_id = j.current_phase_id),
         (SELECT p.id FROM public.onboarding_pipelines p
           WHERE p.tenant_id = j.tenant_id AND p.phase_id = j.current_phase_id AND p.ativo
           ORDER BY (p.produto_id = j.produto_id) DESC NULLS LAST, p.position LIMIT 1)
       ),
       COALESCE(
         CASE WHEN f.slug = 'implantacao' THEN j.implantacao_iniciada_em END,
         j.sla_iniciado_em, j.data_inicio_planejado, j.created_at
       ),
       j.responsavel_user_id
  FROM public.onboarding_journeys j
  JOIN public.onboarding_phases f ON f.id = j.current_phase_id
 WHERE j.current_phase_id IS NOT NULL
ON CONFLICT (journey_id, phase_id) DO NOTHING;
