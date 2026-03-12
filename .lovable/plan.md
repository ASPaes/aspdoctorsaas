

## Plan: "Atribuídas a mim" filter with role-based visibility

### Problem
Currently the "Minhas" quick pill filters by `assigned_to = user.id`, but there's no filter in the advanced popover. Additionally, the business rule is:
- **Admin**: can filter by any agent (Select dropdown with team members)
- **Regular user**: can only see conversations assigned to them OR unassigned (in queue)

### Changes

#### 1. `ConversationFiltersPopover.tsx`
- Add `assignedToMe` boolean and `assignedToAgent` (string | undefined) to `FiltersState`
- For **admin** users: show a Select "Operador" with options: Todas / Na Fila / [list of tenant agents from profiles+funcionarios]
- For **non-admin** users: show a Switch "Somente atribuídas a mim"
- Update `activeCount` and `handleClear` to include the new fields
- Need `useProfile` + `useAuth` to determine role, and `useTenantUsers` (or a simpler query of profiles) to list agents for admins

#### 2. `ConversationsSidebar.tsx`
- Expand `filters` state to include `assignedToMe: boolean` and `assignedToAgent: string | undefined`
- Wire query params:
  - If `assignedToMe` or `activePill === "mine"`: `assignedTo = user.id`
  - If `assignedToAgent` is set: `assignedTo = assignedToAgent`
- For **non-admin** users: apply a client-side filter so they only see conversations where `assigned_to === user.id` OR `assigned_to === null` (in queue). This enforces the visibility rule regardless of filters.
- Add active filter badges for the new filters
- Persist new filter fields in sessionStorage

#### 3. `useWhatsAppConversations.ts`
- Add `unassigned?: boolean` filter support — already exists in the hook interface but we need to allow combining `assignedTo` OR `unassigned` (OR logic). Currently they're mutually exclusive.
- For non-admin visibility: pass both conditions so the query returns `assigned_to = me OR assigned_to IS NULL`

#### 4. Non-admin visibility enforcement
- In `ConversationsSidebar`, after fetching, apply client-side filter for non-admin users: only show conversations where `assigned_to === user.id || assigned_to === null`
- This is a UI-level restriction (RLS already handles tenant isolation)

### Files modified
- `src/components/whatsapp/conversations/ConversationFiltersPopover.tsx` — add agent filter (role-aware)
- `src/components/whatsapp/conversations/ConversationsSidebar.tsx` — wire new filters, enforce non-admin visibility
- `src/components/whatsapp/conversations/QuickPills.tsx` — no changes needed

