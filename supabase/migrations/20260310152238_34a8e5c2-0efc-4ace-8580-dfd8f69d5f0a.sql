
-- =============================================================
-- PHASE 1: Unify WhatsApp conversations by tenant + phone_number
-- =============================================================

-- 1.1 Add instance_id to whatsapp_messages (nullable)
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS instance_id uuid REFERENCES public.whatsapp_instances(id);

-- Backfill instance_id from the conversation's current instance_id
UPDATE public.whatsapp_messages m
  SET instance_id = c.instance_id
  FROM public.whatsapp_conversations c
  WHERE m.conversation_id = c.id
    AND m.instance_id IS NULL;

-- Index for filtering messages by instance
CREATE INDEX IF NOT EXISTS idx_wa_msg_instance ON public.whatsapp_messages(instance_id);

-- 1.2 Merge duplicate contacts (keep oldest per tenant+phone)
-- Step A: Create temp table mapping duplicate contact_ids to master contact_id
CREATE TEMP TABLE _contact_merge AS
WITH ranked AS (
  SELECT id, tenant_id, phone_number, instance_id, name,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, phone_number ORDER BY created_at ASC) AS rn
  FROM public.whatsapp_contacts
),
masters AS (
  SELECT id AS master_id, tenant_id, phone_number
  FROM ranked WHERE rn = 1
),
dupes AS (
  SELECT r.id AS dupe_id, m.master_id, r.tenant_id, r.phone_number
  FROM ranked r
  JOIN masters m ON m.tenant_id = r.tenant_id AND m.phone_number = r.phone_number
  WHERE r.rn > 1
)
SELECT * FROM dupes;

-- Step B: For each duplicate contact, find its conversations and merge them
-- First, reassign messages from duplicate conversations to the master conversation
-- We need to find master conversations too
CREATE TEMP TABLE _conversation_merge AS
WITH conv_ranked AS (
  SELECT cv.id, cv.contact_id, cv.tenant_id, cv.instance_id,
         ROW_NUMBER() OVER (PARTITION BY cv.tenant_id, cv.contact_id ORDER BY cv.created_at ASC) AS rn
  FROM public.whatsapp_conversations cv
),
-- Also include conversations whose contact_id will be remapped
all_convs AS (
  -- Conversations of master contacts
  SELECT cv.id, cv.contact_id, cv.tenant_id,
         COALESCE(cm.master_id, cv.contact_id) AS effective_contact_id,
         ROW_NUMBER() OVER (
           PARTITION BY cv.tenant_id, COALESCE(cm.master_id, cv.contact_id)
           ORDER BY cv.created_at ASC
         ) AS rn
  FROM public.whatsapp_conversations cv
  LEFT JOIN _contact_merge cm ON cm.dupe_id = cv.contact_id
)
SELECT id AS dupe_conv_id, effective_contact_id AS master_contact_id, tenant_id
FROM all_convs
WHERE rn > 1;

-- Get the master conversation for each tenant+contact
CREATE TEMP TABLE _master_convs AS
SELECT DISTINCT ON (tenant_id, effective_contact_id)
  id AS master_conv_id, effective_contact_id AS master_contact_id, tenant_id
FROM (
  SELECT cv.id, cv.tenant_id,
         COALESCE(cm.master_id, cv.contact_id) AS effective_contact_id,
         cv.created_at
  FROM public.whatsapp_conversations cv
  LEFT JOIN _contact_merge cm ON cm.dupe_id = cv.contact_id
  ORDER BY cv.created_at ASC
) sub
ORDER BY tenant_id, effective_contact_id, created_at ASC;

-- Move messages from duplicate conversations to master conversations
UPDATE public.whatsapp_messages msg
SET conversation_id = mc.master_conv_id
FROM _conversation_merge cm
JOIN _master_convs mc ON mc.tenant_id = cm.tenant_id AND mc.master_contact_id = cm.master_contact_id
WHERE msg.conversation_id = cm.dupe_conv_id;

-- Move conversation notes
UPDATE public.whatsapp_conversation_notes n
SET conversation_id = mc.master_conv_id
FROM _conversation_merge cm
JOIN _master_convs mc ON mc.tenant_id = cm.tenant_id AND mc.master_contact_id = cm.master_contact_id
WHERE n.conversation_id = cm.dupe_conv_id;

-- Move conversation summaries
UPDATE public.whatsapp_conversation_summaries s
SET conversation_id = mc.master_conv_id
FROM _conversation_merge cm
JOIN _master_convs mc ON mc.tenant_id = cm.tenant_id AND mc.master_contact_id = cm.master_contact_id
WHERE s.conversation_id = cm.dupe_conv_id;

-- Move conversation assignments
UPDATE public.conversation_assignments ca
SET conversation_id = mc.master_conv_id
FROM _conversation_merge cm
JOIN _master_convs mc ON mc.tenant_id = cm.tenant_id AND mc.master_contact_id = cm.master_contact_id
WHERE ca.conversation_id = cm.dupe_conv_id;

-- Delete duplicate conversations
DELETE FROM public.whatsapp_conversations
WHERE id IN (SELECT dupe_conv_id FROM _conversation_merge);

-- Update remaining conversations to point to master contact
UPDATE public.whatsapp_conversations cv
SET contact_id = cm.master_id
FROM _contact_merge cm
WHERE cv.contact_id = cm.dupe_id;

-- Delete duplicate contacts
DELETE FROM public.whatsapp_contacts
WHERE id IN (SELECT dupe_id FROM _contact_merge);

-- Clean up temp tables
DROP TABLE IF EXISTS _contact_merge;
DROP TABLE IF EXISTS _conversation_merge;
DROP TABLE IF EXISTS _master_convs;

-- 1.3 Change unique constraint on whatsapp_contacts: instance+phone -> tenant+phone
ALTER TABLE public.whatsapp_contacts
  DROP CONSTRAINT IF EXISTS whatsapp_contacts_instance_phone_unique;

ALTER TABLE public.whatsapp_contacts
  ADD CONSTRAINT whatsapp_contacts_tenant_phone_unique UNIQUE (tenant_id, phone_number);

-- Make instance_id nullable on contacts (contact is now tenant-scoped)
ALTER TABLE public.whatsapp_contacts
  ALTER COLUMN instance_id DROP NOT NULL;

-- 1.4 Make instance_id nullable on conversations (conversation is now cross-instance)
ALTER TABLE public.whatsapp_conversations
  ALTER COLUMN instance_id DROP NOT NULL;

-- Add unique constraint: one conversation per contact per tenant
ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_tenant_contact_unique UNIQUE (tenant_id, contact_id);

-- Refresh conversation metadata (last_message_at, unread_count) for merged conversations
UPDATE public.whatsapp_conversations cv
SET
  last_message_at = sub.last_ts,
  last_message_preview = sub.last_preview,
  unread_count = sub.unread
FROM (
  SELECT
    m.conversation_id,
    MAX(m.timestamp) AS last_ts,
    (ARRAY_AGG(m.content ORDER BY m.timestamp DESC))[1] AS last_preview,
    COUNT(*) FILTER (WHERE NOT m.is_from_me) AS unread
  FROM public.whatsapp_messages m
  GROUP BY m.conversation_id
) sub
WHERE cv.id = sub.conversation_id;
