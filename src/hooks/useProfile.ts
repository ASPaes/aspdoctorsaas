import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;

export function useProfile(userId: string | undefined) {
  return useQuery<Profile | null>({
    queryKey: ["profile", userId],
    enabled: !!userId,
    staleTime: 10 * 60 * 1000, // 10 min
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, tenant_id, role, is_super_admin, status, created_at, access_status, allowed_domain, approved_at, approved_by, invited_at, invited_by")
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Creates a tenant + profile for first-time users (self-serve onboarding).
 * Returns the new tenant_id.
 */
export async function createTenantForNewUser(nomeTenant: string): Promise<string> {
  const { data, error } = await supabase.rpc("create_tenant_for_new_user", {
    p_nome: nomeTenant,
  });
  if (error) throw error;
  return data as string;
}
