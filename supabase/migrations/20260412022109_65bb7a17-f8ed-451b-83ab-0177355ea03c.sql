
-- 1. Delete messages linked to Meta Cloud conversations
DELETE FROM whatsapp_messages 
WHERE conversation_id IN (
  SELECT c.id FROM whatsapp_conversations c
  JOIN whatsapp_instances i ON i.id = c.instance_id
  WHERE i.provider_type = 'meta_cloud'
);

-- 2. Delete conversation notes
DELETE FROM whatsapp_conversation_notes
WHERE conversation_id IN (
  SELECT c.id FROM whatsapp_conversations c
  JOIN whatsapp_instances i ON i.id = c.instance_id
  WHERE i.provider_type = 'meta_cloud'
);

-- 3. Delete conversation summaries
DELETE FROM whatsapp_conversation_summaries
WHERE conversation_id IN (
  SELECT c.id FROM whatsapp_conversations c
  JOIN whatsapp_instances i ON i.id = c.instance_id
  WHERE i.provider_type = 'meta_cloud'
);

-- 4. Delete conversation assignments
DELETE FROM conversation_assignments
WHERE conversation_id IN (
  SELECT c.id FROM whatsapp_conversations c
  JOIN whatsapp_instances i ON i.id = c.instance_id
  WHERE i.provider_type = 'meta_cloud'
);

-- 5. Delete support attendances
DELETE FROM support_attendances
WHERE conversation_id IN (
  SELECT c.id FROM whatsapp_conversations c
  JOIN whatsapp_instances i ON i.id = c.instance_id
  WHERE i.provider_type = 'meta_cloud'
);

-- 6. Delete conversations
DELETE FROM whatsapp_conversations
WHERE instance_id IN (
  SELECT id FROM whatsapp_instances WHERE provider_type = 'meta_cloud'
);

-- 7. Delete contacts linked to Meta instances
DELETE FROM whatsapp_contacts
WHERE instance_id IN (
  SELECT id FROM whatsapp_instances WHERE provider_type = 'meta_cloud'
);

-- 8. Delete assignment rules
DELETE FROM assignment_rules
WHERE instance_id IN (
  SELECT id FROM whatsapp_instances WHERE provider_type = 'meta_cloud'
);

-- 9. Delete the instances themselves
DELETE FROM whatsapp_instances
WHERE provider_type = 'meta_cloud';
