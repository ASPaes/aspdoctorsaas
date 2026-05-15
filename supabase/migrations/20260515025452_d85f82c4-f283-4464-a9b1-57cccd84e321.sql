-- Add rules_disabled flag to whatsapp_contacts
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS rules_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rules_disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS rules_disabled_by uuid,
  ADD COLUMN IF NOT EXISTS rules_disabled_reason text;

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_rules_disabled
  ON public.whatsapp_contacts (tenant_id, phone_number)
  WHERE rules_disabled = true;

-- Trigger: propagate rules_disabled across all contacts with same phone+tenant (independent of instance)
CREATE OR REPLACE FUNCTION public.propagate_rules_disabled()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rules_disabled IS DISTINCT FROM OLD.rules_disabled THEN
    UPDATE public.whatsapp_contacts
       SET rules_disabled = NEW.rules_disabled,
           rules_disabled_at = NEW.rules_disabled_at,
           rules_disabled_by = NEW.rules_disabled_by,
           rules_disabled_reason = NEW.rules_disabled_reason
     WHERE tenant_id = NEW.tenant_id
       AND phone_number = NEW.phone_number
       AND id <> NEW.id
       AND rules_disabled IS DISTINCT FROM NEW.rules_disabled;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_rules_disabled ON public.whatsapp_contacts;
CREATE TRIGGER trg_propagate_rules_disabled
  AFTER UPDATE OF rules_disabled ON public.whatsapp_contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.propagate_rules_disabled();