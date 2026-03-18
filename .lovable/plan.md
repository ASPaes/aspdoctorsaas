

## Plan: Sub-aba "Setores" em Configurações > WhatsApp

### No Database Changes Needed
All tables (`support_departments`, `support_department_instances`, `funcionarios` with `department_id`) already exist with proper RLS policies and types.

### Files to Create

**`src/components/configuracoes/whatsapp/SetoresTab.tsx`** — Main component with master-detail layout:

- **Left column**: List of `support_departments` (tenant-scoped via RLS). Shows name, active/inactive badge, "Fallback" badge. "Novo Setor" button. Click selects.
- **Right column** (when selected): Three sections:
  - **A) Dados do Setor**: Form with name, description, is_active toggle, is_default_fallback toggle. Slug auto-generated from name on save. Upsert mutation. Confirm dialog before deactivating.
  - **B) Instâncias**: Fetch `whatsapp_instances` (tenant). Fetch `support_department_instances` for selected department. Checkbox list to link/unlink instances (insert/delete rows). Select for `default_instance_id` (must be among linked instances).
  - **C) Usuários**: Table of `funcionarios` (tenant). Columns: nome, email, cargo, setor (dropdown updating `department_id`), ativo. Join profiles via `funcionario_id` for email. "Sem setor" option sets `department_id = null`.

- Uses React Query for all data fetching/mutations with `useTenantFilter()`.
- Loading skeletons, empty state, toast on save.
- Responsive: on small screens, department list becomes a select dropdown above the detail panel.

### Files to Modify

**`src/pages/Configuracoes.tsx`** — In `WhatsAppSettingsContent`:
- Import `SetoresTab`
- Add `<TabsTrigger value="setores">Setores</TabsTrigger>` between "equipe" and "seguranca"
- Add `<TabsContent value="setores"><SetoresTab /></TabsContent>`

### Data Flow
```text
support_departments ──────┐
support_department_instances ──┤── SetoresTab (master-detail)
funcionarios (department_id) ──┤
whatsapp_instances ────────┤
profiles (for email) ──────┘
```

### Access Control
Already handled: the WhatsApp tab is visible to all users, but the "Setores" sub-tab will only appear when `isAdmin` is true (checked from `useAuth()` in the parent component, passed down or checked inside SetoresTab).

