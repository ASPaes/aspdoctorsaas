
DO $$
DECLARE
  v_conv UUID := 'cd24af40-39ee-437d-991e-0649dfa0781a';
  v_att_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO v_att_ids FROM support_attendances WHERE conversation_id = v_conv;

  IF v_att_ids IS NOT NULL THEN
    UPDATE support_kb_articles SET source_attendance_id = NULL WHERE source_attendance_id = ANY(v_att_ids);
    UPDATE support_tickets SET attendance_id = NULL WHERE attendance_id = ANY(v_att_ids);
    DELETE FROM support_csat WHERE attendance_id = ANY(v_att_ids);
  END IF;

  DELETE FROM whatsapp_message_edit_history WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_reactions WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_messages WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_conversation_notes WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_conversation_summaries WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_sentiment_analysis WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_sentiment_history WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_topics_history WHERE conversation_id = v_conv;
  DELETE FROM notification_conversation_mute WHERE conversation_id = v_conv;
  DELETE FROM conversation_assignments WHERE conversation_id = v_conv;
  DELETE FROM support_attendances WHERE conversation_id = v_conv;
  DELETE FROM whatsapp_conversations WHERE id = v_conv;
END $$;
