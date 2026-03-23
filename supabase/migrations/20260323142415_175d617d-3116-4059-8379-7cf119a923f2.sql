CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog', 'public'
AS $$
BEGIN
  -- Only allow admins/super_admins to change sensitive columns
  IF NOT public.is_super_admin() AND NOT public.is_tenant_admin() THEN
    IF OLD.role IS DISTINCT FROM NEW.role THEN
      RAISE EXCEPTION 'Only admins can change the role column';
    END IF;
    IF OLD.access_status IS DISTINCT FROM NEW.access_status THEN
      RAISE EXCEPTION 'Only admins can change the access_status column';
    END IF;
    IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'Only admins can change the tenant_id column';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER trg_protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();