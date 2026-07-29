import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface OnboardingPhase {
  id: string;
  nome: string;
  /** Identificador estável das fases-semente: onboarding | implantacao | acompanhamento.
   *  Fase criada pelo tenant tem slug null — nunca ramifique lógica por nome. */
  slug: string | null;
  cor: string | null;
  ativo: boolean;
  position: number;
}

export const ONBOARDING_PHASES_QUERY_KEY = "onb-phases";

/**
 * Jornadas do onboarding, cadastradas por tenant.
 * Substitui o enum onb_fase ("onboarding" | "implantacao") que era espelhado
 * hardcoded em 7 arquivos do front. Um tenant pode desativar jornadas e rodar
 * com uma só — nesse caso a lista tem 1 item e as pills não são renderizadas.
 */
export function useOnboardingPhases(
  tenantId: string | null,
  opts?: { somenteAtivas?: boolean; enabled?: boolean },
) {
  const somenteAtivas = opts?.somenteAtivas ?? true;
  return useQuery({
    queryKey: [ONBOARDING_PHASES_QUERY_KEY, tenantId, somenteAtivas],
    enabled: (opts?.enabled ?? true) && !!tenantId,
    queryFn: async () => {
      let q = (supabase.from("onboarding_phases" as any) as any)
        .select("id, nome, slug, cor, ativo, position")
        .eq("tenant_id", tenantId)
        .order("position");
      if (somenteAtivas) q = q.eq("ativo", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OnboardingPhase[];
    },
  });
}

/** Acha a fase pelo slug-semente. Retorna undefined se o tenant desativou/não tem. */
export function findPhaseBySlug(
  phases: OnboardingPhase[] | undefined,
  slug: string,
): OnboardingPhase | undefined {
  return (phases ?? []).find((p) => p.slug === slug);
}
