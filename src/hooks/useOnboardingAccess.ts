import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function useOnboardingAccess() {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;

  const q = useQuery<boolean>({
    queryKey: ["tenant-onboarding-enabled", profile?.tenant_id],
    enabled: !!profile?.tenant_id && !isSuperAdmin,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("tenants" as any) as any)
        .select("onboarding_enabled").eq("id", profile!.tenant_id).maybeSingle();
      if (error) throw error;
      return !!(data as any)?.onboarding_enabled;
    },
  });

  const canAccess = isSuperAdmin || (q.data ?? false);
  const isLoading = !isSuperAdmin && !!profile?.tenant_id && q.isLoading;
  return { canAccess, isLoading };
}
