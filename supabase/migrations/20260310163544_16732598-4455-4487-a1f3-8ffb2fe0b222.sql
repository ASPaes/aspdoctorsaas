-- Add sender_name and sender_role columns to whatsapp_messages for direct storage
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_name text;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS sender_role text;

-- Backfill existing messages with sender info from profiles + funcionarios
UPDATE whatsapp_messages m
SET 
  sender_name = f.nome,
  sender_role = f.cargo
FROM profiles p
JOIN funcionarios f ON f.id = p.funcionario_id
WHERE m.sent_by_user_id = p.user_id
  AND m.is_from_me = true
  AND m.sender_name IS NULL
  AND p.funcionario_id IS NOT NULL;