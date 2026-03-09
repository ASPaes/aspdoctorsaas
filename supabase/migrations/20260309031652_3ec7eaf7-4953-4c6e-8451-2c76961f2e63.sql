CREATE OR REPLACE FUNCTION public.set_tenant_id_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if public.is_super_admin() then
    -- Super admin: keep provided tenant_id, fallback to current
    if new.tenant_id is null then
      new.tenant_id := public.current_tenant_id();
    end if;
  else
    -- Regular user OR service role (no auth context):
    -- Keep explicitly provided tenant_id, only override if null
    declare
      v_current_tenant uuid;
    begin
      v_current_tenant := public.current_tenant_id();
      if v_current_tenant is not null then
        new.tenant_id := v_current_tenant;
      end if;
      -- If v_current_tenant is null (e.g. service role), keep the provided new.tenant_id
    end;
  end if;
  return new;
end;
$function$;