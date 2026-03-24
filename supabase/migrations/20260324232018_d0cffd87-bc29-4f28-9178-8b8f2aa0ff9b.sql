
CREATE OR REPLACE FUNCTION public.funcionario_require_email_and_department_when_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if coalesce(new.ativo, false) then
    if new.email is null or btrim(new.email) = '' then
      raise exception 'Funcionário ativo precisa ter email preenchido';
    end if;
    if new.department_id is null then
      raise exception 'Funcionário ativo precisa ter setor (department_id) definido';
    end if;
  end if;

  return new;
end;
$function$;
