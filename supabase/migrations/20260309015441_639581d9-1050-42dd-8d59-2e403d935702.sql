
-- =====================================================
-- WhatsApp Multi-Tenant Schema for Doctor SaaS
-- Phase 1: Foundation
-- =====================================================

-- 1. Enum for sentiment analysis
CREATE TYPE public.sentiment_type AS ENUM ('positive', 'neutral', 'negative');

-- 2. whatsapp_instances
CREATE TABLE public.whatsapp_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  instance_name TEXT NOT NULL,
  display_name TEXT,
  phone_number TEXT,
  provider_type TEXT NOT NULL DEFAULT 'self_hosted',
  instance_id_external TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, instance_name)
);

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_instances_tenant_rw" ON public.whatsapp_instances FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_instances BEFORE INSERT ON public.whatsapp_instances FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_whatsapp_instances BEFORE UPDATE ON public.whatsapp_instances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. whatsapp_instance_secrets (restricted RLS: admin only)
CREATE TABLE public.whatsapp_instance_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  api_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(instance_id)
);

ALTER TABLE public.whatsapp_instance_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_instance_secrets FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_instance_secrets_admin_rw" ON public.whatsapp_instance_secrets FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id) AND is_tenant_admin()) WITH CHECK (can_access_tenant_row(tenant_id) AND is_tenant_admin());
CREATE TRIGGER set_tenant_id_whatsapp_instance_secrets BEFORE INSERT ON public.whatsapp_instance_secrets FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_whatsapp_instance_secrets BEFORE UPDATE ON public.whatsapp_instance_secrets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. whatsapp_contacts
CREATE TABLE public.whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  name TEXT,
  profile_picture_url TEXT,
  is_group BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_contacts_tenant_rw" ON public.whatsapp_contacts FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_contacts BEFORE INSERT ON public.whatsapp_contacts FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_whatsapp_contacts BEFORE UPDATE ON public.whatsapp_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_whatsapp_contacts_instance ON public.whatsapp_contacts(instance_id);
CREATE INDEX idx_whatsapp_contacts_phone ON public.whatsapp_contacts(instance_id, phone_number);
CREATE INDEX idx_whatsapp_contacts_tenant ON public.whatsapp_contacts(tenant_id);

-- 5. whatsapp_conversations
CREATE TABLE public.whatsapp_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  assigned_to UUID,
  status TEXT NOT NULL DEFAULT 'active',
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  category TEXT,
  priority TEXT DEFAULT 'normal',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_conversations_tenant_rw" ON public.whatsapp_conversations FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_conversations BEFORE INSERT ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_whatsapp_conversations BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_whatsapp_conversations_instance ON public.whatsapp_conversations(instance_id);
CREATE INDEX idx_whatsapp_conversations_contact ON public.whatsapp_conversations(contact_id);
CREATE INDEX idx_whatsapp_conversations_assigned ON public.whatsapp_conversations(assigned_to);
CREATE INDEX idx_whatsapp_conversations_tenant ON public.whatsapp_conversations(tenant_id);
CREATE INDEX idx_whatsapp_conversations_last_msg ON public.whatsapp_conversations(last_message_at DESC);

-- 6. whatsapp_messages
CREATE TABLE public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  remote_jid TEXT,
  content TEXT NOT NULL DEFAULT '',
  message_type TEXT NOT NULL DEFAULT 'text',
  media_url TEXT,
  media_mimetype TEXT,
  is_from_me BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'sent',
  quoted_message_id TEXT,
  original_content TEXT,
  edited_at TIMESTAMPTZ,
  audio_transcription TEXT,
  transcription_status TEXT,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_messages_tenant_rw" ON public.whatsapp_messages FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_messages BEFORE INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE INDEX idx_whatsapp_messages_conversation ON public.whatsapp_messages(conversation_id);
CREATE INDEX idx_whatsapp_messages_message_id ON public.whatsapp_messages(message_id);
CREATE INDEX idx_whatsapp_messages_timestamp ON public.whatsapp_messages(conversation_id, timestamp DESC);
CREATE INDEX idx_whatsapp_messages_tenant ON public.whatsapp_messages(tenant_id);

-- 7. whatsapp_macros
CREATE TABLE public.whatsapp_macros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  instance_id UUID REFERENCES public.whatsapp_instances(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  shortcut TEXT,
  category TEXT,
  is_global BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_macros ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_macros FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_macros_tenant_rw" ON public.whatsapp_macros FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_macros BEFORE INSERT ON public.whatsapp_macros FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_whatsapp_macros BEFORE UPDATE ON public.whatsapp_macros FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. whatsapp_conversation_notes
CREATE TABLE public.whatsapp_conversation_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_conversation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_conversation_notes_tenant_rw" ON public.whatsapp_conversation_notes FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_conversation_notes BEFORE INSERT ON public.whatsapp_conversation_notes FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_whatsapp_conversation_notes BEFORE UPDATE ON public.whatsapp_conversation_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 9. whatsapp_conversation_summaries
CREATE TABLE public.whatsapp_conversation_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_conversation_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversation_summaries FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_conversation_summaries_tenant_rw" ON public.whatsapp_conversation_summaries FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_conversation_summaries BEFORE INSERT ON public.whatsapp_conversation_summaries FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 10. whatsapp_reactions
CREATE TABLE public.whatsapp_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  reactor_jid TEXT NOT NULL,
  is_from_me BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(message_id, reactor_jid)
);

ALTER TABLE public.whatsapp_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_reactions FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_reactions_tenant_rw" ON public.whatsapp_reactions FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_reactions BEFORE INSERT ON public.whatsapp_reactions FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 11. whatsapp_message_edit_history
CREATE TABLE public.whatsapp_message_edit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  previous_content TEXT NOT NULL,
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_message_edit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_edit_history FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_message_edit_history_tenant_rw" ON public.whatsapp_message_edit_history FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_message_edit_history BEFORE INSERT ON public.whatsapp_message_edit_history FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 12. whatsapp_sentiment_analysis
CREATE TABLE public.whatsapp_sentiment_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  sentiment public.sentiment_type NOT NULL DEFAULT 'neutral',
  confidence NUMERIC(5,4),
  keywords TEXT[] DEFAULT '{}',
  summary TEXT,
  topics TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id)
);

ALTER TABLE public.whatsapp_sentiment_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sentiment_analysis FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_sentiment_analysis_tenant_rw" ON public.whatsapp_sentiment_analysis FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_sentiment_analysis BEFORE INSERT ON public.whatsapp_sentiment_analysis FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 13. whatsapp_sentiment_history
CREATE TABLE public.whatsapp_sentiment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  sentiment public.sentiment_type NOT NULL,
  confidence NUMERIC(5,4),
  keywords TEXT[] DEFAULT '{}',
  summary TEXT,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_sentiment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_sentiment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_sentiment_history_tenant_rw" ON public.whatsapp_sentiment_history FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_sentiment_history BEFORE INSERT ON public.whatsapp_sentiment_history FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 14. whatsapp_topics_history
CREATE TABLE public.whatsapp_topics_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  topics TEXT[] DEFAULT '{}',
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_topics_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_topics_history FORCE ROW LEVEL SECURITY;
CREATE POLICY "whatsapp_topics_history_tenant_rw" ON public.whatsapp_topics_history FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_whatsapp_topics_history BEFORE INSERT ON public.whatsapp_topics_history FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 15. conversation_assignments
CREATE TABLE public.conversation_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  assigned_to UUID,
  assigned_by UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.conversation_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY "conversation_assignments_tenant_rw" ON public.conversation_assignments FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_conversation_assignments BEFORE INSERT ON public.conversation_assignments FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 16. assignment_rules
CREATE TABLE public.assignment_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL DEFAULT 'round_robin',
  is_active BOOLEAN NOT NULL DEFAULT true,
  fixed_agent_id UUID,
  round_robin_agents UUID[] DEFAULT '{}',
  round_robin_last_index INTEGER NOT NULL DEFAULT -1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.assignment_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY "assignment_rules_tenant_rw" ON public.assignment_rules FOR ALL TO authenticated USING (can_access_tenant_row(tenant_id)) WITH CHECK (can_access_tenant_row(tenant_id));
CREATE TRIGGER set_tenant_id_assignment_rules BEFORE INSERT ON public.assignment_rules FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();
CREATE TRIGGER set_updated_at_assignment_rules BEFORE UPDATE ON public.assignment_rules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- Archive triggers for sentiment and topics
-- =====================================================

CREATE OR REPLACE FUNCTION public.archive_sentiment_to_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN
    IF TG_OP = 'UPDATE' THEN
      INSERT INTO public.whatsapp_sentiment_history (
        tenant_id, conversation_id, contact_id, sentiment, confidence, keywords, summary
      ) VALUES (
        OLD.tenant_id, OLD.conversation_id, OLD.contact_id, OLD.sentiment, OLD.confidence, OLD.keywords, OLD.summary
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archive_sentiment
  BEFORE UPDATE ON public.whatsapp_sentiment_analysis
  FOR EACH ROW
  EXECUTE FUNCTION public.archive_sentiment_to_history();

CREATE OR REPLACE FUNCTION public.archive_topics_to_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.topics IS DISTINCT FROM NEW.topics THEN
    INSERT INTO public.whatsapp_topics_history (
      tenant_id, conversation_id, topics
    ) VALUES (
      OLD.tenant_id, OLD.conversation_id, OLD.topics
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archive_topics
  BEFORE UPDATE ON public.whatsapp_sentiment_analysis
  FOR EACH ROW
  EXECUTE FUNCTION public.archive_topics_to_history();

-- =====================================================
-- Enable Realtime
-- =====================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_instances;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_reactions;

-- =====================================================
-- Storage bucket
-- =====================================================
INSERT INTO storage.buckets (id, name, public) VALUES ('whatsapp-media', 'whatsapp-media', true);

CREATE POLICY "whatsapp_media_select" ON storage.objects FOR SELECT TO public USING (bucket_id = 'whatsapp-media');
CREATE POLICY "whatsapp_media_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'whatsapp-media');
CREATE POLICY "whatsapp_media_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'whatsapp-media');
CREATE POLICY "whatsapp_media_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'whatsapp-media');
