UPDATE public.movimentos_mrr m
SET tenant_id = c.tenant_id
FROM public.clientes c
WHERE m.cliente_id = c.id
  AND m.tenant_id IS DISTINCT FROM c.tenant_id;

CREATE OR REPLACE FUNCTION public.set_movimento_mrr_tenant_from_cliente()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cliente_tenant uuid;
BEGIN
  SELECT c.tenant_id
    INTO v_cliente_tenant
  FROM public.clientes c
  WHERE c.id = NEW.cliente_id;

  IF v_cliente_tenant IS NULL THEN
    RAISE EXCEPTION 'Cliente % não encontrado para movimento MRR', NEW.cliente_id;
  END IF;

  NEW.tenant_id := v_cliente_tenant;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_tenant_movimentos_mrr ON public.movimentos_mrr;

CREATE TRIGGER trg_set_tenant_movimentos_mrr
BEFORE INSERT OR UPDATE OF cliente_id ON public.movimentos_mrr
FOR EACH ROW
EXECUTE FUNCTION public.set_movimento_mrr_tenant_from_cliente();