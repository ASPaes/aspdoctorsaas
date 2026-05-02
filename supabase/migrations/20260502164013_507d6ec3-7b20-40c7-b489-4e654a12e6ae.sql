ALTER TABLE public.whatsapp_instances 
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_active 
  ON public.whatsapp_instances(tenant_id, is_active);