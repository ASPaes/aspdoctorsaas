-- Filtro de unidade passa a enxergar unidades inativas (para consultar histórico),
-- devolvendo is_active para a UI sinalizar. Cadastro continua sem oferecer inativa.
-- Tipo de retorno muda => DROP + CREATE (CREATE OR REPLACE não permite) + grants refeitos.
DROP FUNCTION IF EXISTS public.get_my_allowed_unidades(uuid);

CREATE FUNCTION public.get_my_allowed_unidades(p_tenant_id uuid)
 RETURNS TABLE(id bigint, nome text, is_principal boolean, is_default_filter boolean, is_active boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_super_admin()
     OR COALESCE((SELECT acesso_todas_unidades FROM profiles WHERE user_id = auth.uid()), true) THEN
    RETURN QUERY
      SELECT u.id, u.nome, u.is_principal, u.is_default_filter, COALESCE(u.is_active, true)
      FROM unidades_base u
      WHERE u.tenant_id = p_tenant_id
      ORDER BY COALESCE(u.is_active, true) DESC, u.is_principal DESC, u.nome;
  ELSE
    RETURN QUERY
      SELECT u.id, u.nome, u.is_principal, u.is_default_filter, COALESCE(u.is_active, true)
      FROM unidades_base u
      JOIN profile_unidades pu ON pu.unidade_base_id = u.id AND pu.user_id = auth.uid()
      WHERE u.tenant_id = p_tenant_id
      ORDER BY COALESCE(u.is_active, true) DESC, u.is_principal DESC, u.nome;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_allowed_unidades(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_allowed_unidades(uuid) TO authenticated, service_role;
