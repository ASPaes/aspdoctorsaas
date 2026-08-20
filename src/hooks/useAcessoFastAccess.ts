import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Libera o botão "Conectar" (AcessoFast) por tenant, via flag
 * `tenants.acessofast_enabled` — mesmo desenho do useOnboardingAccess.
 *
 * Padrão `false`: quem não contratou o AcessoFast não vê um botão que cai no
 * login de um sistema que não conhece.
 */
export function useAcessoFastAccess() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;

  const q = useQuery<boolean>({
    queryKey: ["tenant-acessofast-enabled", profile?.tenant_id],
    enabled: !!profile?.tenant_id && !isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenants" as any) as any)
        .select("acessofast_enabled").eq("id", profile!.tenant_id).maybeSingle();
      if (error) throw error;
      return !!(data as any)?.acessofast_enabled;
    },
  });

  const canAccess = isSuperAdmin || (q.data ?? false);
  const isLoading = !isSuperAdmin && !!profile?.tenant_id && q.isLoading;
  return { canAccess, isLoading };
}
