-- Fix: Make whatsapp-media bucket private to prevent unauthorized access
UPDATE storage.buckets SET public = false WHERE id = 'whatsapp-media';

-- Add RLS policies for authenticated users to access whatsapp-media
CREATE POLICY "whatsapp_media_select_authenticated"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'whatsapp-media');

CREATE POLICY "whatsapp_media_insert_authenticated"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "whatsapp_media_update_authenticated"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'whatsapp-media')
WITH CHECK (bucket_id = 'whatsapp-media');

CREATE POLICY "whatsapp_media_delete_authenticated"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'whatsapp-media');