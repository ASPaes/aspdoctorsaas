
DO $$
DECLARE
  v_conv_id uuid := '25a6d27a-32b5-4c39-914c-7e267085e6ec';
BEGIN
  -- Desvincular KB articles
  UPDATE public.support_kb_articles
  SET source_attendance_id = NULL
  WHERE source_attendance_id IN (
    SELECT id FROM public.support_attendances WHERE conversation_id = v_conv_id
  );

  -- Sentiments
  DELETE FROM public.whatsapp_sentiment_analysis WHERE conversation_id = v_conv_id;
  DELETE FROM public.whatsapp_sentiment_history WHERE conversation_id = v_conv_id;
  DELETE FROM public.whatsapp_topics_history WHERE conversation_id = v_conv_id;

  -- Notas e resumos
  DELETE FROM public.whatsapp_conversation_notes WHERE conversation_id = v_conv_id;
  DELETE FROM public.whatsapp_conversation_summaries WHERE conversation_id = v_conv_id;

  -- Reações (message_id é text, id das mensagens é uuid — cast)
  DELETE FROM public.whatsapp_reactions
  WHERE message_id IN (
    SELECT id::text FROM public.whatsapp_messages WHERE conversation_id = v_conv_id
  );

  -- Edições (message_id pode ser text também)
  DELETE FROM public.whatsapp_message_edit_history
  WHERE message_id::uuid IN (
    SELECT id FROM public.whatsapp_messages WHERE conversation_id = v_conv_id
  );

  -- Mensagens
  DELETE FROM public.whatsapp_messages WHERE conversation_id = v_conv_id;

  -- Atendimentos
  DELETE FROM public.support_attendances WHERE conversation_id = v_conv_id;

  -- Assignments
  DELETE FROM public.conversation_assignments WHERE conversation_id = v_conv_id;

  -- Conversa
  DELETE FROM public.whatsapp_conversations WHERE id = v_conv_id;
END $$;
