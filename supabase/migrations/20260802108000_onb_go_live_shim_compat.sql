-- SHIM TEMPORÁRIO de compatibilidade do go-live.
--
-- fn_journey_go_live mudou o 3º parâmetro de p_demand_type_id (uuid) para
-- p_produto_id (bigint). Como os tipos diferem, as duas assinaturas CONVIVEM como
-- sobrecarga — e o PostgREST resolve pelo nome do parâmetro.
--
-- Este shim existe porque o frontend em produção ainda chamava a assinatura antiga
-- no momento da migration do banco. Sem ele, "Nova jornada" e "Editar informações"
-- quebrariam entre a subida do banco e o deploy do frontend.
--
-- Ignora o tipo de demanda: o prazo agora vem do trilho (produto NULL = trilho padrão).
--
-- ⚠️ REMOVER logo após o deploy do frontend:
--    DROP FUNCTION public.fn_journey_go_live(uuid, timestamptz, uuid, uuid);

CREATE OR REPLACE FUNCTION public.fn_journey_go_live(
  p_tenant_id uuid,
  p_start timestamptz,
  p_demand_type_id uuid,
  p_department_id uuid DEFAULT NULL
) RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.fn_journey_go_live(p_tenant_id, p_start, NULL::bigint, p_department_id);
$function$;

COMMENT ON FUNCTION public.fn_journey_go_live(uuid, timestamptz, uuid, uuid) IS
  'DEPRECADA (01/08): shim de compatibilidade para o frontend antigo. Ignora o tipo de demanda. Remover após o deploy do frontend.';
