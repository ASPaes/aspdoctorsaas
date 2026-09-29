-- DEM-0469: adicionar/remover participante da jornada so para admin, head,
-- o responsavel da jornada ou super admin (mesma regra de set_onboarding_participant_role).
-- As RPCs que gravam participante sozinhas (criar jornada, treino, transferencia,
-- devolver ao vendedor) sao SECURITY DEFINER do postgres, dono da tabela sem
-- FORCE RLS: nao passam por estas policies.

CREATE OR REPLACE FUNCTION public.fn_onb_pode_gerir_participantes(p_ticket_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- is_super_admin() pode devolver NULL: o coalesce impede o NULL de virar "passa".
  SELECT coalesce(public.is_super_admin(), false)
      OR EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = auth.uid() AND p.role IN ('admin', 'head'))
      OR EXISTS (SELECT 1 FROM public.onboarding_journeys j
                  WHERE j.ticket_id = p_ticket_id AND j.responsavel_user_id = auth.uid());
$function$;

REVOKE ALL ON FUNCTION public.fn_onb_pode_gerir_participantes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_onb_pode_gerir_participantes(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS onboarding_participants_ins ON public.onboarding_participants;
CREATE POLICY onboarding_participants_ins ON public.onboarding_participants
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_tenant_row(tenant_id)
              AND public.fn_onb_pode_gerir_participantes(ticket_id));

DROP POLICY IF EXISTS onboarding_participants_del ON public.onboarding_participants;
CREATE POLICY onboarding_participants_del ON public.onboarding_participants
  FOR DELETE TO authenticated
  USING (public.can_access_tenant_row(tenant_id)
         AND public.fn_onb_pode_gerir_participantes(ticket_id));

DROP POLICY IF EXISTS onboarding_participants_upd ON public.onboarding_participants;
CREATE POLICY onboarding_participants_upd ON public.onboarding_participants
  FOR UPDATE TO authenticated
  USING (public.can_access_tenant_row(tenant_id)
         AND public.fn_onb_pode_gerir_participantes(ticket_id))
  WITH CHECK (public.can_access_tenant_row(tenant_id)
              AND public.fn_onb_pode_gerir_participantes(ticket_id));
