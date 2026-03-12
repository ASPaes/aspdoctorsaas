
-- Trigger to validate matriz_id on clientes insert/update
-- Rules:
-- 1. Cannot reference itself (matriz_id = id)
-- 2. Cannot reference a client that is already a filial (has matriz_id set)
-- Both rules scoped to same tenant for multi-tenant safety

CREATE OR REPLACE FUNCTION public.validate_matriz_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_matriz_id uuid;
BEGIN
  -- Skip if no matriz_id set
  IF NEW.matriz_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Rule 1: Cannot be its own matriz
  IF NEW.matriz_id = NEW.id THEN
    RAISE EXCEPTION 'Um cliente não pode ser matriz dele mesmo.';
  END IF;

  -- Rule 2: The target client must not be a filial itself
  SELECT matriz_id INTO v_target_matriz_id
  FROM public.clientes
  WHERE id = NEW.matriz_id
    AND tenant_id = NEW.tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cliente matriz não encontrado.';
  END IF;

  IF v_target_matriz_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este cliente é uma filial e não pode ser usado como Matriz.';
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS trg_validate_matriz_id ON public.clientes;
CREATE TRIGGER trg_validate_matriz_id
  BEFORE INSERT OR UPDATE OF matriz_id ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_matriz_id();
