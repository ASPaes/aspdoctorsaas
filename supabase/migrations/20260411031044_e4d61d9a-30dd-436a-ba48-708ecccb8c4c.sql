ALTER TABLE public.whatsapp_instance_secrets
ADD COLUMN IF NOT EXISTS zapi_token TEXT,
ADD COLUMN IF NOT EXISTS zapi_client_token TEXT;