CREATE OR REPLACE FUNCTION public.search_clientes_for_link(p_tenant_id uuid, p_term text)
 RETURNS TABLE(id uuid, razao_social text, nome_fantasia text, telefone_whatsapp text, cnpj text, codigo_sequencial integer)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Autorização: super admin ou membro ativo do tenant cujo id bate com o solicitado
  IF NOT (
    public.is_super_admin()
    OR (public.is_tenant_active_member() AND public.current_tenant_id() = p_tenant_id)
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH input AS (
    SELECT
      trim(coalesce(p_term, '')) AS raw_term,
      regexp_replace(coalesce(p_term, ''), '[^0-9]', '', 'g') AS digits
  )
  SELECT
    c.id, c.razao_social, c.nome_fantasia, c.telefone_whatsapp, c.cnpj, c.codigo_sequencial
  FROM clientes c
  CROSS JOIN input i
  WHERE c.tenant_id = p_tenant_id
    AND coalesce(c.cancelado, false) = false
    AND length(i.raw_term) >= 2
    AND (
      (length(i.digits) BETWEEN 1 AND 6
       AND length(i.raw_term) = length(i.digits)
       AND c.codigo_sequencial::text = i.digits)
      OR
      (length(i.digits) >= 3
       AND position(i.digits in regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g')) > 0)
      OR
      (length(i.digits) >= 8
       AND right(regexp_replace(coalesce(c.telefone_whatsapp, ''), '[^0-9]', '', 'g'), 10)
           = right(i.digits, 10))
      OR
      (i.raw_term ~ '[a-zA-Z]'
       AND (position(lower(i.raw_term) in lower(coalesce(c.razao_social, ''))) > 0
            OR position(lower(i.raw_term) in lower(coalesce(c.nome_fantasia, ''))) > 0))
    )
  ORDER BY
    CASE
      WHEN length(i.digits) BETWEEN 1 AND 6
           AND length(i.raw_term) = length(i.digits)
           AND c.codigo_sequencial::text = i.digits THEN 0
      WHEN length(i.digits) >= 3
           AND regexp_replace(coalesce(c.cnpj, ''), '[^0-9]', '', 'g') LIKE i.digits || '%' THEN 1
      ELSE 2
    END,
    c.codigo_sequencial NULLS LAST,
    c.nome_fantasia NULLS LAST
  LIMIT 20;
END;
$function$;