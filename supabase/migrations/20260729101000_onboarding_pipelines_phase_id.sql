-- Entrega A / Task 2 — pipelines apontam para a fase cadastrada, não para o enum.

ALTER TABLE public.onboarding_pipelines
  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES public.onboarding_phases(id) ON DELETE RESTRICT;

UPDATE public.onboarding_pipelines p
   SET phase_id = f.id
  FROM public.onboarding_phases f
 WHERE f.tenant_id = p.tenant_id
   AND f.slug = p.fase::text
   AND p.phase_id IS NULL;

ALTER TABLE public.onboarding_pipelines ALTER COLUMN phase_id SET NOT NULL;
-- `fase` deixa de ser obrigatória: jornadas fora do enum (acompanhamento, ou criadas
-- pelo tenant) não têm equivalente. A coluna sai de cena na entrega de limpeza.
ALTER TABLE public.onboarding_pipelines ALTER COLUMN fase DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_onb_pipelines_tenant_phase
  ON public.onboarding_pipelines (tenant_id, phase_id, position);

CREATE OR REPLACE FUNCTION public.fn_sync_onboarding_pipeline_phase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_slug text;
BEGIN
  IF NEW.phase_id IS NULL AND NEW.fase IS NOT NULL THEN
    -- caminho legado: quem escreveu só o enum
    NEW.phase_id := public.fn_onboarding_phase_id(NEW.tenant_id, NEW.fase::text);
    IF NEW.phase_id IS NULL THEN
      RAISE EXCEPTION 'Jornada "%" não está cadastrada para este tenant.', NEW.fase::text
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.phase_id IS NOT NULL THEN
    SELECT slug INTO v_slug FROM public.onboarding_phases WHERE id = NEW.phase_id;
    -- só espelha no enum quando existe equivalente; senão deixa nulo
    NEW.fase := CASE WHEN v_slug IN ('onboarding','implantacao')
                     THEN v_slug::public.onb_fase ELSE NULL END;
  END IF;

  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_sync_onb_pipeline_phase ON public.onboarding_pipelines;
CREATE TRIGGER trg_sync_onb_pipeline_phase
  BEFORE INSERT OR UPDATE ON public.onboarding_pipelines
  FOR EACH ROW EXECUTE FUNCTION public.fn_sync_onboarding_pipeline_phase();
