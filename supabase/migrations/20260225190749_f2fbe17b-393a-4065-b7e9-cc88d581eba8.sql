
CREATE OR REPLACE FUNCTION public.set_tenant_id_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin
  if public.is_super_admin() then
    if new.tenant_id is null then
      new.tenant_id := public.current_tenant_id();
    end if;
  else
    new.tenant_id := public.current_tenant_id();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_cs_tickets_atualizado_em()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$function$;
