-- Entrega A / Task 3 — o registro por fase passa a apontar para a fase cadastrada.

ALTER TABLE public.onboarding_phase_metrics
  ADD COLUMN IF NOT EXISTS phase_id    uuid REFERENCES public.onboarding_phases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES public.onboarding_pipelines(id) ON DELETE SET NULL;

UPDATE public.onboarding_phase_metrics m
   SET phase_id = f.id
  FROM public.onboarding_phases f
 WHERE f.tenant_id = m.tenant_id
   AND f.slug = m.fase::text
   AND m.phase_id IS NULL;

-- pipeline que a jornada percorreu naquela fase (best effort no histórico existente)
UPDATE public.onboarding_phase_metrics m
   SET pipeline_id = CASE WHEN m.fase::text = 'implantacao'
                          THEN j.pipeline_implantacao_id ELSE j.pipeline_onboarding_id END
  FROM public.onboarding_journeys j
 WHERE j.id = m.journey_id AND m.pipeline_id IS NULL;

ALTER TABLE public.onboarding_phase_metrics ALTER COLUMN phase_id SET NOT NULL;
ALTER TABLE public.onboarding_phase_metrics ALTER COLUMN fase DROP NOT NULL;

-- A unique (journey_id, fase) NÃO sai: fn_snapshot_onboarding_phase depende dela.
CREATE UNIQUE INDEX IF NOT EXISTS uq_onb_phase_metrics_journey_phase
  ON public.onboarding_phase_metrics (journey_id, phase_id);

CREATE OR REPLACE FUNCTION public.fn_sync_onboarding_phase_metric()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_slug text;
BEGIN
  IF NEW.phase_id IS NULL AND NEW.fase IS NOT NULL THEN
    NEW.phase_id := public.fn_onboarding_phase_id(NEW.tenant_id, NEW.fase::text);
  ELSIF NEW.phase_id IS NOT NULL AND NEW.fase IS NULL THEN
    SELECT slug INTO v_slug FROM public.onboarding_phases WHERE id = NEW.phase_id;
    NEW.fase := CASE WHEN v_slug IN ('onboarding','implantacao')
                     THEN v_slug::public.onb_fase ELSE NULL END;
  END IF;

  IF NEW.phase_id IS NULL THEN
    RAISE EXCEPTION 'Métrica de fase sem jornada cadastrada (journey %).', NEW.journey_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_onb_phase_metric ON public.onboarding_phase_metrics;
CREATE TRIGGER trg_sync_onb_phase_metric
  BEFORE INSERT OR UPDATE ON public.onboarding_phase_metrics
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_onboarding_phase_metric();
