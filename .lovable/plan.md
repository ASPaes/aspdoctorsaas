

## Diagnosis

Camila Marques (role: `user`, department: `Financeiro`) cannot transfer conversations to other departments because of an RLS policy conflict on the `support_attendances` table.

The UPDATE policy `support_attendances_update_by_department` has a `WITH CHECK` clause that requires the **new** `department_id` to match the user's own department. When Camila transfers to "Implantação", the update sets `department_id = 'implantacao_id'` which doesn't match her `current_user_department_id()` (Financeiro), so PostgreSQL rejects the write.

The same issue may also affect the `whatsapp_conversations` SELECT policy — after updating the conversation's `department_id` to a different department, Camila can no longer read that conversation (which is expected), but the subsequent queries in the mutation chain may also fail.

## Root Cause

The `support_attendances_update_by_department` policy's `WITH CHECK` is too restrictive:
```sql
WITH CHECK (
  is_admin_or_head() OR 
  (department_id = current_user_department_id() AND tenant_id = current_tenant_id())
)
```

This blocks any non-admin from updating an attendance to a different department — which is exactly what a department transfer does.

## Fix

Create a migration that relaxes the `WITH CHECK` on the `support_attendances` UPDATE policy to allow users to transfer attendances **from** their own department **to** any department within their tenant:

```sql
-- Drop and recreate the update policy
DROP POLICY IF EXISTS "support_attendances_update_by_department" ON support_attendances;

CREATE POLICY "support_attendances_update_by_department"
  ON support_attendances
  FOR UPDATE
  USING (
    is_admin_or_head() 
    OR (department_id = current_user_department_id() AND tenant_id = current_tenant_id())
  )
  WITH CHECK (
    is_admin_or_head() 
    OR (tenant_id = current_tenant_id() AND current_user_department_id() IS NOT NULL)
  );
```

The `USING` clause still ensures users can only update attendances from their own department. The `WITH CHECK` clause is relaxed to allow the new row to have any `department_id` within the tenant — the key security constraint remains that the user must belong to the original department (enforced by `USING`).

## Impact
- **Security**: Users can only transfer attendances that belong to their own department (USING unchanged). They cannot arbitrarily modify attendances from other departments.
- **No code changes**: Only a database migration is needed.
- **Files**: One new migration file.

## Manual Test
1. Log in as Camila Marques (Financeiro, role: user)
2. Open a conversation assigned to her
3. Click "Transferir Conversa" > Setor > select "Implantação"
4. Click "Transferir Setor"
5. Expected: Success toast, conversation moves to Implantação queue

