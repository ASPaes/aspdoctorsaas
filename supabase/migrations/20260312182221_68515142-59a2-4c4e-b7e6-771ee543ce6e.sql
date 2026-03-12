
-- Add signature mode columns to whatsapp_conversations
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS sender_signature_mode text NOT NULL DEFAULT 'name',
  ADD COLUMN IF NOT EXISTS sender_ticket_code text NULL;

-- Add check constraint for valid values
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT chk_sender_signature_mode
  CHECK (sender_signature_mode IN ('name', 'none', 'ticket'));

-- Add check constraint for ticket code format (max 20 chars, alphanumeric + -/#)
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT chk_sender_ticket_code
  CHECK (sender_ticket_code IS NULL OR (
    length(sender_ticket_code) <= 20 AND
    sender_ticket_code ~ '^[a-zA-Z0-9\-\/#]+$'
  ));
