import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OnboardingParticipantRole {
  id: string;
  nome: string;
  slug: string | null;
  cor: string;
  ativo: boolean;
  position: number;
}

export const ONBOARDING_ROLES_QUERY_KEY = "onb-participant-roles";

/**
 * Papéis de participante do onboarding, cadastrados por tenant.
 * Substitui o enum onb_participante_papel que era espelhado hardcoded no front.
 */
export function useOnboardingParticipantRoles(
  tenantId: string | null,
  opts?: { somenteAtivos?: boolean; enabled?: boolean },
) {
  const somenteAtivos = opts?.somenteAtivos ?? false;
  return useQuery({
    queryKey: [ONBOARDING_ROLES_QUERY_KEY, tenantId, somenteAtivos],
    enabled: (opts?.enabled ?? true) && !!tenantId,
    queryFn: async () => {
      let q = (supabase.from("onboarding_participant_roles" as any) as any)
        .select("id, nome, slug, cor, ativo, position")
        .eq("tenant_id", tenantId)
        .order("position");
      if (somenteAtivos) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OnboardingParticipantRole[];
    },
  });
}
