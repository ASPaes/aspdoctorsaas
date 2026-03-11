
-- Add soft-delete columns to whatsapp_messages
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS deleted_by uuid NULL,
  ADD COLUMN IF NOT EXISTS delete_scope text NULL,
  ADD COLUMN IF NOT EXISTS delete_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS delete_error text NULL;

-- Add CHECK constraint for valid values
ALTER TABLE public.whatsapp_messages
  ADD CONSTRAINT chk_delete_scope CHECK (delete_scope IS NULL OR delete_scope IN ('local', 'everyone')),
  ADD CONSTRAINT chk_delete_status CHECK (delete_status IN ('active', 'pending', 'revoked', 'failed'));

-- Performance index for filtering active messages per conversation
CREATE INDEX IF NOT EXISTS idx_wa_msg_conv_delete_status 
  ON public.whatsapp_messages (conversation_id, delete_status, timestamp DESC);
