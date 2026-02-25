-- Fix 1: Enable RLS on clientes_old_import
ALTER TABLE public.clientes_old_import ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_clientes_old_import"
ON public.clientes_old_import
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "auth_write_clientes_old_import"
ON public.clientes_old_import
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);