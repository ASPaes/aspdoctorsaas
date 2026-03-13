
ALTER TABLE public.support_attendances
ADD COLUMN IF NOT EXISTS ura_sent_at timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ura_option_selected integer DEFAULT NULL;
