ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS opened_out_of_hours_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS out_of_hours_cleared_at timestamptz DEFAULT NULL;