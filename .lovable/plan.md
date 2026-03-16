

## Fix: Instance Change Failing Due to Contact Constraint

### Problem
The `useChangeInstance` hook searches for existing contacts filtering by `instance_id`, missing the tenant-level contact that already exists. It then tries to insert a duplicate, violating the `whatsapp_contacts_tenant_phone_unique` constraint.

### Solution
Simplify the hook: since contacts are unified at tenant level, the same contact_id can be used across instances. The hook only needs to update the conversation's `instance_id` — no contact creation or lookup needed.

### Changes

**File: `src/components/whatsapp/hooks/useChangeInstance.ts`**
- Remove the contact lookup by `instance_id`
- Remove the contact creation logic
- Simply update the conversation's `instance_id` (keep the same `contact_id`)
- The mutation becomes a single update call

### Technical Detail
The cross-instance unification (memory) established that contacts use `(tenant_id, phone_number)` as the unique key. The conversation already points to the correct contact. Changing instance only means future messages go through a different WhatsApp number — the contact record stays the same.

