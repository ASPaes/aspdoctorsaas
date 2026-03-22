UPDATE public.support_attendances
SET status = 'closed',
    closed_at = now(),
    closed_reason = 'manual',
    updated_at = now()
WHERE status IN ('waiting', 'in_progress');