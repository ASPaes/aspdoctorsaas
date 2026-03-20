

# Fix: Use Department's Default Instance for Chat Links

## Problem
When clicking the WhatsApp chat icon from Certificados A1 or Clientes, the system always uses `instances[0].id` (first instance in the list) regardless of the user's department. It should use the `default_instance_id` configured for the user's department.

## Root Cause
In `src/pages/WhatsApp.tsx` line 101:
```typescript
const instanceId = instances[0].id;
```
This ignores the department context entirely.

## Solution
**Single file change: `src/pages/WhatsApp.tsx`**

Use `useDepartmentFilter()` to get `selectedDepartment` (which includes `default_instance_id`), then resolve the instance in priority order:

1. `selectedDepartment.default_instance_id` (if exists and is in the instances list)
2. `instances[0].id` (fallback)

### Changes:
1. Import `useDepartmentFilter` (already available since the component is wrapped in `DepartmentFilterProvider`)
2. Call `const { selectedDepartment } = useDepartmentFilter();` inside `WhatsAppContent`
3. Replace line 101 with instance resolution logic:
```typescript
const deptDefaultId = selectedDepartment?.default_instance_id;
const instanceId = (deptDefaultId && instances.find(i => i.id === deptDefaultId))
  ? deptDefaultId
  : instances[0].id;
```

No other files need changes — the department context and `default_instance_id` data are already in place.

