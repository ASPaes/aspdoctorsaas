
-- Fix stuck attendance 00319/26 for Silvano's conversation
UPDATE public.support_attendances
SET status = 'closed',
    closed_at = now(),
    closed_reason = 'manual_fix_orphaned_csat_race',
    updated_at = now()
WHERE id = '73b85147-7fb1-46c4-9e3a-4212b930d261'
  AND status = 'in_progress';
