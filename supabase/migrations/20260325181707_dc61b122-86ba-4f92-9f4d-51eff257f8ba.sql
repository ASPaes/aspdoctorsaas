
-- 1. Create table
CREATE TABLE public.business_hours_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  date date NOT NULL,
  type text NOT NULL CHECK (type IN ('holiday', 'collective_leave')),
  name text,
  is_closed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_hours_exceptions_tenant_date_unique UNIQUE (tenant_id, date)
);

-- 2. RLS
ALTER TABLE public.business_hours_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_hours_exceptions FORCE ROW LEVEL SECURITY;

-- Admin/head can do everything within their tenant
CREATE POLICY "bhe_admin_rw" ON public.business_hours_exceptions
  FOR ALL TO authenticated
  USING (
    can_access_tenant_row(tenant_id)
    AND (is_admin_or_head() OR is_super_admin())
  )
  WITH CHECK (
    can_access_tenant_row(tenant_id)
    AND (is_admin_or_head() OR is_super_admin())
  );

-- Regular authenticated users can read their tenant's exceptions
CREATE POLICY "bhe_tenant_select" ON public.business_hours_exceptions
  FOR SELECT TO authenticated
  USING (can_access_tenant_row(tenant_id));

-- 3. Trigger for updated_at
CREATE TRIGGER set_updated_at_business_hours_exceptions
  BEFORE UPDATE ON public.business_hours_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Trigger to auto-set tenant_id on insert
CREATE TRIGGER set_tenant_on_insert_business_hours_exceptions
  BEFORE INSERT ON public.business_hours_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_on_insert();

-- 5. Index for tenant queries
CREATE INDEX idx_bhe_tenant_date ON public.business_hours_exceptions (tenant_id, date);
