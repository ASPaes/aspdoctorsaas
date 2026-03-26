
-- Excluir dados do número 5549933661011

-- 1) Atendimentos
DELETE FROM public.support_attendances WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';

-- 2) Mensagens e dependências
DELETE FROM public.whatsapp_message_edit_history WHERE message_id IN (SELECT id::text FROM public.whatsapp_messages WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba');
DELETE FROM public.whatsapp_reactions WHERE message_id IN (SELECT id::text FROM public.whatsapp_messages WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba');
DELETE FROM public.whatsapp_messages WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';

-- 3) Sentimentos e tópicos
DELETE FROM public.whatsapp_sentiment_analysis WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';
DELETE FROM public.whatsapp_sentiment_history WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';
DELETE FROM public.whatsapp_topics_history WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';

-- 4) Notas e resumos
DELETE FROM public.whatsapp_conversation_notes WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';
DELETE FROM public.whatsapp_conversation_summaries WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';

-- 5) Assignments
DELETE FROM public.conversation_assignments WHERE conversation_id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';

-- 6) Conversa
DELETE FROM public.whatsapp_conversations WHERE id = '1466629c-87df-4d26-b21d-6eb152d6c9ba';

-- 7) Contato
DELETE FROM public.whatsapp_contacts WHERE id = 'a5f0e761-a9ea-4660-809f-79e13abea0c0';
