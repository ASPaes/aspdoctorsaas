-- Remove FORCE ROW LEVEL SECURITY from WhatsApp tables
-- service_role key used by Edge Functions needs to bypass RLS for legitimate operations
ALTER TABLE public.whatsapp_messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_contacts NO FORCE ROW LEVEL SECURITY;