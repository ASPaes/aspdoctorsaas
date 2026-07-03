
CREATE OR REPLACE FUNCTION public.whatsapp_contacts_enforce_group_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.phone_number IS NOT NULL AND NEW.phone_number ~ '^[0-9]{15,}$' THEN
    IF NEW.is_group IS DISTINCT FROM TRUE THEN
      NEW.is_group := TRUE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_contacts_enforce_group_shape ON public.whatsapp_contacts;
CREATE TRIGGER trg_whatsapp_contacts_enforce_group_shape
BEFORE INSERT OR UPDATE OF phone_number, is_group ON public.whatsapp_contacts
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_contacts_enforce_group_shape();
