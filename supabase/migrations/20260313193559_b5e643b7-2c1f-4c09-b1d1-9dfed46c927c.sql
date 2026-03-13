
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS ura_invalid_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ura_human_fallback boolean NOT NULL DEFAULT false;
