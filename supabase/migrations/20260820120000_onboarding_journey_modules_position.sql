-- Ordenação manual dos módulos da jornada de onboarding.
-- Até aqui a lista saía por created_at e não havia como reordenar.

ALTER TABLE public.onboarding_journey_modules
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- Backfill: mantém a ordem que a tela já mostrava (created_at), por jornada.
WITH ord AS (
  SELECT id,
         row_number() OVER (PARTITION BY journey_id ORDER BY created_at, id) AS rn
  FROM public.onboarding_journey_modules
)
UPDATE public.onboarding_journey_modules m
   SET position = ord.rn
  FROM ord
 WHERE ord.id = m.id
   AND m.position = 0;
