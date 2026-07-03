
-- Reforça trava: telefone de contato de grupo é imutável (só troca por outro JID de grupo)
CREATE OR REPLACE FUNCTION public.whatsapp_contacts_enforce_group_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  digits_new text;
  digits_old text;
BEGIN
  digits_new := regexp_replace(coalesce(NEW.phone_number, ''), '\D', '', 'g');

  -- Regra 1: telefone com 15+ dígitos = JID de grupo, força is_group=true
  IF length(digits_new) >= 15 THEN
    NEW.is_group := true;
  END IF;

  -- Regra 2: se marcado como grupo, normaliza para só dígitos
  IF NEW.is_group = true THEN
    NEW.phone_number := digits_new;
  END IF;

  -- Regra 3 (nova trava): em UPDATE, se já era grupo, phone_number é imutável
  --   a não ser que o novo valor também seja um JID de grupo válido (15+ dígitos)
  IF TG_OP = 'UPDATE' AND OLD.is_group = true THEN
    digits_old := regexp_replace(coalesce(OLD.phone_number, ''), '\D', '', 'g');

    IF digits_new <> digits_old AND length(digits_new) < 15 THEN
      RAISE EXCEPTION
        'Não é permitido alterar o telefone de um contato de grupo (%). O identificador do grupo (JID) é imutável. Contato: %',
        digits_old, OLD.id
        USING ERRCODE = '23514';
    END IF;

    -- Regra 4 (nova trava): não permite "desagrupar" um contato de grupo
    IF NEW.is_group = false THEN
      RAISE EXCEPTION
        'Não é permitido remover a marcação de grupo do contato %. Grupos não podem virar contatos individuais.',
        OLD.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Reforça também nas conversas: não deixa conversa de grupo perder is_group/group_jid
CREATE OR REPLACE FUNCTION public.whatsapp_conversations_enforce_group_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  contact_is_group boolean;
  contact_phone text;
BEGIN
  SELECT is_group, phone_number
    INTO contact_is_group, contact_phone
  FROM public.whatsapp_contacts
  WHERE id = NEW.contact_id;

  IF contact_is_group = true THEN
    NEW.is_group := true;
    IF NEW.group_jid IS NULL OR NEW.group_jid = '' THEN
      NEW.group_jid := contact_phone || '@g.us';
    END IF;
  END IF;

  -- Em UPDATE, se já era grupo, não pode perder is_group nem group_jid
  IF TG_OP = 'UPDATE' AND OLD.is_group = true THEN
    IF NEW.is_group = false THEN
      RAISE EXCEPTION
        'Não é permitido remover a marcação de grupo da conversa %.',
        OLD.id
        USING ERRCODE = '23514';
    END IF;
    IF NEW.group_jid IS NULL OR NEW.group_jid = '' THEN
      NEW.group_jid := COALESCE(OLD.group_jid, contact_phone || '@g.us');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
