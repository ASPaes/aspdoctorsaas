-- Entrega A / Task 4 — a jornada aponta para a fase cadastrada em que está.

ALTER TABLE public.onboarding_journeys
  ADD COLUMN IF NOT EXISTS current_phase_id uuid REFERENCES public.onboarding_phases(id) ON DELETE RESTRICT;

UPDATE public.onboarding_journeys j
   SET current_phase_id = f.id
  FROM public.onboarding_phases f
 WHERE f.tenant_id = j.tenant_id
   AND f.slug = j.fase_atual::text
   AND j.fase_atual::text <> 'concluido'
   AND j.current_phase_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_onb_journeys_tenant_phase
  ON public.onboarding_journeys (tenant_id, current_phase_id);

CREATE OR REPLACE FUNCTION public.fn_sync_onboarding_journey_phase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_slug text;
BEGIN
  -- caminho legado (todas as RPCs de hoje): escreveram fase_atual, derivamos current_phase_id
  IF TG_OP = 'INSERT' OR NEW.fase_atual IS DISTINCT FROM OLD.fase_atual THEN
    IF NEW.fase_atual::text = 'concluido' THEN
      NEW.current_phase_id := NULL;
    ELSE
      NEW.current_phase_id := public.fn_onboarding_phase_id(NEW.tenant_id, NEW.fase_atual::text);
    END IF;
    RETURN NEW;
  END IF;

  -- caminho novo (Entrega C em diante): escreveram current_phase_id, espelhamos no enum
  IF NEW.current_phase_id IS DISTINCT FROM OLD.current_phase_id THEN
    IF NEW.current_phase_id IS NULL THEN
      NEW.fase_atual := 'concluido';
    ELSE
      SELECT slug INTO v_slug FROM public.onboarding_phases WHERE id = NEW.current_phase_id;
      -- fase fora do enum mantém o último valor válido; a coluna sai na limpeza
      IF v_slug IN ('onboarding','implantacao') THEN
        NEW.fase_atual := v_slug::public.onb_fase_atual;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_onb_journey_phase ON public.onboarding_journeys;
CREATE TRIGGER trg_sync_onb_journey_phase
  BEFORE INSERT OR UPDATE ON public.onboarding_journeys
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_onboarding_journey_phase();
