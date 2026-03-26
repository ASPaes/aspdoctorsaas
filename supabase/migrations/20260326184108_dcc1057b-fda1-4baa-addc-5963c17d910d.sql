
-- Excluir dados do número 5549933661011 (Zetta)

-- 0) KB articles
DELETE FROM public.support_kb_articles WHERE source_attendance_id IN ('f4aa6b33-c0e0-47b7-a949-0fc00680b65e', '36bf8e9b-214b-4344-854a-3cb54b121951');

-- 1) Atendimentos
DELETE FROM public.support_attendances WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';

-- 2) Mensagens e dependências
DELETE FROM public.whatsapp_message_edit_history WHERE message_id IN (SELECT id::text FROM public.whatsapp_messages WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a');
DELETE FROM public.whatsapp_reactions WHERE message_id IN (SELECT id::text FROM public.whatsapp_messages WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a');
DELETE FROM public.whatsapp_messages WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';

-- 3) Sentimentos e tópicos
DELETE FROM public.whatsapp_sentiment_analysis WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';
DELETE FROM public.whatsapp_sentiment_history WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';
DELETE FROM public.whatsapp_topics_history WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';

-- 4) Notas e resumos
DELETE FROM public.whatsapp_conversation_notes WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';
DELETE FROM public.whatsapp_conversation_summaries WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';

-- 5) Assignments
DELETE FROM public.conversation_assignments WHERE conversation_id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';

-- 6) Conversa
DELETE FROM public.whatsapp_conversations WHERE id = 'e4974dfb-51eb-4e8f-9da5-d8a353c10f0a';

-- 7) Contato
DELETE FROM public.whatsapp_contacts WHERE id = '5b2afd2b-4fe3-4910-a15f-2975e3500a1b';
