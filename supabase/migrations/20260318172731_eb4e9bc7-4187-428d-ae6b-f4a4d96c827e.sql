
-- Step 1: Drop the old unique constraint (tenant_id, contact_id)
ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_tenant_contact_unique;

-- Step 2: Create new unique constraint (tenant_id, instance_id, contact_id)
-- This ensures each instance has its own conversation per contact per tenant
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_tenant_instance_contact_unique
    UNIQUE (tenant_id, instance_id, contact_id);
