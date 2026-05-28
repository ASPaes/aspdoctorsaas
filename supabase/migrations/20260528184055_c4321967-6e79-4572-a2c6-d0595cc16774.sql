
DO $$
DECLARE
  v_convs uuid[] := ARRAY['bf0ac4bb-863e-4e8e-a87e-5ceeecd87d5a','5be4a75e-3c30-491b-ae6f-bddf1a9ee5db']::uuid[];
  v_contacts uuid[] := ARRAY['c2d32e80-ab13-49eb-aa10-abb25174f73e','8a6187d2-675b-47f1-baa6-2a2b971209e5']::uuid[];
  v_attendances uuid[];
BEGIN
  SELECT array_agg(id) INTO v_attendances FROM support_attendances WHERE conversation_id = ANY(v_convs) OR contact_id = ANY(v_contacts);
  IF v_attendances IS NULL THEN v_attendances := ARRAY[]::uuid[]; END IF;

  -- preserve KB articles, just unlink
  UPDATE support_kb_articles SET source_attendance_id = NULL WHERE source_attendance_id = ANY(v_attendances);

  -- attendance-dependent
  DELETE FROM support_csat WHERE attendance_id = ANY(v_attendances);
  DELETE FROM support_tickets WHERE attendance_id = ANY(v_attendances) OR contact_id = ANY(v_contacts);
  DELETE FROM data_integrity_issues WHERE attendance_id = ANY(v_attendances) OR conversation_id = ANY(v_convs);

  -- message-dependent
  DELETE FROM whatsapp_message_edit_history WHERE conversation_id = ANY(v_convs);
  DELETE FROM whatsapp_reactions WHERE conversation_id = ANY(v_convs);
  DELETE FROM whatsapp_messages WHERE conversation_id = ANY(v_convs);

  -- conversation-dependent
  DELETE FROM conversation_assignments WHERE conversation_id = ANY(v_convs);
  DELETE FROM notification_conversation_mute WHERE conversation_id = ANY(v_convs);
  DELETE FROM notification_dispatch_queue WHERE conversation_id = ANY(v_convs);
  DELETE FROM notifications WHERE conversation_id = ANY(v_convs);
  DELETE FROM whatsapp_conversation_notes WHERE conversation_id = ANY(v_convs);
  DELETE FROM whatsapp_conversation_summaries WHERE conversation_id = ANY(v_convs);
  DELETE FROM whatsapp_topics_history WHERE conversation_id = ANY(v_convs);
  DELETE FROM whatsapp_sentiment_analysis WHERE conversation_id = ANY(v_convs) OR contact_id = ANY(v_contacts);
  DELETE FROM whatsapp_sentiment_history WHERE conversation_id = ANY(v_convs) OR contact_id = ANY(v_contacts);
  DELETE FROM client_alert_audit WHERE conversation_id = ANY(v_convs) OR contact_id = ANY(v_contacts);

  -- attendances
  DELETE FROM support_attendances WHERE conversation_id = ANY(v_convs) OR contact_id = ANY(v_contacts);

  -- conversations
  DELETE FROM whatsapp_conversations WHERE id = ANY(v_convs);

  -- contact-dependent
  DELETE FROM cliente_avaliacoes_atendimento WHERE contact_id = ANY(v_contacts);
  DELETE FROM client_alerts WHERE contact_id = ANY(v_contacts);

  -- contacts
  DELETE FROM whatsapp_contacts WHERE id = ANY(v_contacts);
END $$;
