-- One-time data fix: mark all conversations as read
UPDATE whatsapp_conversations SET unread_count = 0 WHERE unread_count > 0;