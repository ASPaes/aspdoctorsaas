UPDATE whatsapp_conversations
SET opened_out_of_hours = false,
    out_of_hours_cleared_at = now()
WHERE opened_out_of_hours = true
  AND (
    status = 'closed'
    OR first_agent_message_at IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM support_attendances sa
      WHERE sa.conversation_id = whatsapp_conversations.id
        AND sa.status IN ('in_progress', 'closed', 'inactive_closed')
    )
  );