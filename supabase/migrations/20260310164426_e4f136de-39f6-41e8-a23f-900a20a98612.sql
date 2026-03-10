
-- Add media metadata columns to whatsapp_messages
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_path text;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_filename text;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_ext text;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_size_bytes bigint;
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS media_kind text;

-- Backfill media_path from media_url
UPDATE whatsapp_messages
SET media_path = CASE
  -- Signed URL: extract path after 'whatsapp-media/'
  WHEN media_url LIKE '%/storage/v1/object/sign/whatsapp-media/%' THEN
    split_part(split_part(media_url, '/storage/v1/object/sign/whatsapp-media/', 2), '?', 1)
  -- Direct storage URL with /whatsapp-media/
  WHEN media_url LIKE '%/whatsapp-media/%' THEN
    split_part(media_url, '/whatsapp-media/', 2)
  -- Not a URL, assume it's already a path
  WHEN media_url IS NOT NULL AND media_url NOT LIKE 'http%' THEN
    media_url
  ELSE NULL
END
WHERE media_url IS NOT NULL AND media_path IS NULL;

-- Backfill media_filename
UPDATE whatsapp_messages
SET media_filename = COALESCE(
  metadata->>'fileName',
  metadata->>'filename',
  metadata->>'originalName',
  metadata->>'name',
  CASE WHEN media_path IS NOT NULL AND media_path LIKE '%/%'
    THEN reverse(split_part(reverse(media_path), '/', 1))
    WHEN media_path IS NOT NULL
    THEN media_path
    ELSE NULL
  END
)
WHERE media_url IS NOT NULL AND media_filename IS NULL;

-- Backfill media_ext from filename or mimetype
UPDATE whatsapp_messages
SET media_ext = CASE
  WHEN media_filename IS NOT NULL AND media_filename LIKE '%.%'
    THEN lower(reverse(split_part(reverse(media_filename), '.', 1)))
  WHEN COALESCE(media_mimetype, '') LIKE 'image/%'
    THEN split_part(split_part(COALESCE(media_mimetype,''), '/', 2), ';', 1)
  WHEN COALESCE(media_mimetype, '') LIKE 'audio/%'
    THEN split_part(split_part(COALESCE(media_mimetype,''), '/', 2), ';', 1)
  WHEN COALESCE(media_mimetype, '') LIKE 'video/%'
    THEN split_part(split_part(COALESCE(media_mimetype,''), '/', 2), ';', 1)
  WHEN COALESCE(media_mimetype, '') LIKE 'application/pdf' THEN 'pdf'
  ELSE NULL
END
WHERE media_url IS NOT NULL AND media_ext IS NULL;

-- Backfill media_kind
UPDATE whatsapp_messages
SET media_kind = CASE
  WHEN message_type IN ('image') OR COALESCE(media_mimetype,'') LIKE 'image/%' THEN 'image'
  WHEN message_type IN ('audio') OR COALESCE(media_mimetype,'') LIKE 'audio/%' THEN 'audio'
  WHEN message_type IN ('video') OR COALESCE(media_mimetype,'') LIKE 'video/%' THEN 'video'
  WHEN message_type IN ('document') OR COALESCE(media_mimetype,'') LIKE 'application/pdf'
    OR COALESCE(media_mimetype,'') LIKE 'application/msword'
    OR COALESCE(media_mimetype,'') LIKE 'application/vnd%' THEN 'document'
  WHEN media_url IS NOT NULL THEN 'other'
  ELSE NULL
END
WHERE media_url IS NOT NULL AND media_kind IS NULL;

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conv_ts
  ON whatsapp_messages (tenant_id, conversation_id, timestamp DESC);
