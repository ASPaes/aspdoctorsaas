-- Checklist da etapa por tipo de demanda (11/08/2026).
-- Grupo SEM vínculo vale para todas as demandas; com vínculo, só nas listadas.
-- Item sem grupo (group_id IS NULL) sempre vale — não há onde pendurar vínculo.

CREATE TABLE IF NOT EXISTS public.onboarding_checklist_group_demand_types (
  group_id       uuid NOT NULL REFERENCES public.onboarding_stage_checklist_groups(id) ON DELETE CASCADE,
  demand_type_id uuid NOT NULL REFERENCES public.onboarding_demand_types(id)           ON DELETE CASCADE,
  tenant_id      uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, demand_type_id)
);

CREATE INDEX IF NOT EXISTS idx_onb_ck_group_demand_tenant
  ON public.onboarding_checklist_group_demand_types (tenant_id, demand_type_id);

ALTER TABLE public.onboarding_checklist_group_demand_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS onb_ck_group_demand_sel ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_sel ON public.onboarding_checklist_group_demand_types
  FOR SELECT USING (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onb_ck_group_demand_ins ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_ins ON public.onboarding_checklist_group_demand_types
  FOR INSERT WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onb_ck_group_demand_upd ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_upd ON public.onboarding_checklist_group_demand_types
  FOR UPDATE USING (public.can_access_tenant_row(tenant_id))
          WITH CHECK (public.can_access_tenant_row(tenant_id));

DROP POLICY IF EXISTS onb_ck_group_demand_del ON public.onboarding_checklist_group_demand_types;
CREATE POLICY onb_ck_group_demand_del ON public.onboarding_checklist_group_demand_types
  FOR DELETE USING (public.can_access_tenant_row(tenant_id));

-- Fonte ÚNICA da regra. Não reimplementar o predicado inline em nenhuma RPC.
CREATE OR REPLACE FUNCTION public.fn_onb_checklist_grupo_aplica(
  p_group_id uuid, p_demand_type_id uuid
) RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT p_group_id IS NULL
      OR p_demand_type_id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.onboarding_checklist_group_demand_types l
                      WHERE l.group_id = p_group_id)
      OR EXISTS (SELECT 1 FROM public.onboarding_checklist_group_demand_types l
                  WHERE l.group_id = p_group_id AND l.demand_type_id = p_demand_type_id);
$$;

REVOKE ALL ON FUNCTION public.fn_onb_checklist_grupo_aplica(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_onb_checklist_grupo_aplica(uuid, uuid) TO authenticated, service_role;
