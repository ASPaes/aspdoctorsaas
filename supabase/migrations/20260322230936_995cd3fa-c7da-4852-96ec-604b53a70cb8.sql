-- Add billing skip URA config columns to configuracoes
ALTER TABLE public.configuracoes
  ADD COLUMN IF NOT EXISTS billing_skip_ura_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS billing_skip_ura_minutes integer NOT NULL DEFAULT 60;

-- Index for efficient billing message lookups by conversation
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_billing_lookup
  ON public.whatsapp_messages (tenant_id, conversation_id, is_from_me, created_at DESC)
  WHERE is_from_me = true;