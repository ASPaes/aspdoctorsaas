ALTER TABLE public.whatsapp_conversation_notes
  ADD COLUMN media_path text,
  ADD COLUMN media_type text CHECK (media_type IN ('image','video')),
  ADD COLUMN media_mimetype text,
  ADD COLUMN media_filename text,
  ADD COLUMN media_size_bytes bigint;