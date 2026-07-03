CREATE OR REPLACE FUNCTION public.whatsapp_contacts_enforce_group_shape()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_expected_group_phone text;
BEGIN
  IF NEW.phone_number IS NOT NULL THEN
    NEW.phone_number := regexp_replace(NEW.phone_number, '\D', '', 'g');
  END IF;

  SELECT regexp_replace(wc.group_jid, '@g\.us$', '')
    INTO v_expected_group_phone
  FROM public.whatsapp_conversations wc
  WHERE wc.contact_id = COALESCE(NEW.id, OLD.id)
    AND wc.is_group IS TRUE
    AND wc.group_jid ~ '^[0-9]+@g\.us$'
  ORDER BY wc.updated_at DESC NULLS LAST, wc.created_at DESC
  LIMIT 1;

  IF v_expected_group_phone IS NOT NULL THEN
    NEW.is_group := TRUE;

    IF NEW.phone_number IS DISTINCT FROM v_expected_group_phone THEN
      RAISE EXCEPTION 'Contato de grupo deve manter o identificador do grupo (%), não um telefone comum.', v_expected_group_phone
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.phone_number IS NOT NULL AND NEW.phone_number ~ '^[0-9]{15,}$' THEN
    IF NEW.is_group IS DISTINCT FROM TRUE THEN
      NEW.is_group := TRUE;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;