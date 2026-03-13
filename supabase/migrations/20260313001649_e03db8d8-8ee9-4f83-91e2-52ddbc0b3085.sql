
ALTER TABLE public.support_attendances
  ADD COLUMN IF NOT EXISTS reopened_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reopened_from text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS created_from text DEFAULT NULL;

COMMENT ON COLUMN public.support_attendances.reopened_at IS 'Timestamp when attendance was reopened from closed status';
COMMENT ON COLUMN public.support_attendances.reopened_from IS 'Who triggered reopen: customer or agent';
COMMENT ON COLUMN public.support_attendances.created_from IS 'Origin of attendance creation: customer, agent, or system';
