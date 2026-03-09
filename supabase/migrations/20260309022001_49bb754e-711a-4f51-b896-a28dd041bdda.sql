-- Add missing columns for ASP Chat hook compatibility

-- whatsapp_macros: add is_active and usage_count
ALTER TABLE public.whatsapp_macros ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.whatsapp_macros ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

-- whatsapp_conversation_notes: add is_pinned
ALTER TABLE public.whatsapp_conversation_notes ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false;

-- whatsapp_conversation_summaries: add extra fields
ALTER TABLE public.whatsapp_conversation_summaries ADD COLUMN IF NOT EXISTS key_points text[] DEFAULT '{}';
ALTER TABLE public.whatsapp_conversation_summaries ADD COLUMN IF NOT EXISTS action_items text[] DEFAULT '{}';
ALTER TABLE public.whatsapp_conversation_summaries ADD COLUMN IF NOT EXISTS sentiment_at_time text;
ALTER TABLE public.whatsapp_conversation_summaries ADD COLUMN IF NOT EXISTS period_start timestamp with time zone;
ALTER TABLE public.whatsapp_conversation_summaries ADD COLUMN IF NOT EXISTS period_end timestamp with time zone;

-- conversation_assignments: add assigned_from
ALTER TABLE public.conversation_assignments ADD COLUMN IF NOT EXISTS assigned_from uuid;