
CREATE OR REPLACE FUNCTION public.whatsapp_conversations_enforce_group_shape()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_contact_is_group boolean;
  v_contact_phone text;
BEGIN
  IF NEW.contact_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT is_group, phone_number
    INTO v_contact_is_group, v_contact_phone
  FROM public.whatsapp_contacts
  WHERE id = NEW.contact_id;

  IF v_contact_is_group IS TRUE THEN
    IF NEW.is_group IS DISTINCT FROM TRUE THEN
      NEW.is_group := TRUE;
    END IF;
    IF NEW.group_jid IS NULL AND v_contact_phone ~ '^[0-9]{15,}$' THEN
      NEW.group_jid := v_contact_phone || '@g.us';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_conversations_enforce_group_shape ON public.whatsapp_conversations;
CREATE TRIGGER trg_whatsapp_conversations_enforce_group_shape
BEFORE INSERT OR UPDATE OF contact_id, is_group, group_jid ON public.whatsapp_conversations
FOR EACH ROW EXECUTE FUNCTION public.whatsapp_conversations_enforce_group_shape();
