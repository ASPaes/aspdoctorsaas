import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Returns the department_id the current user belongs to
 * (from support_department_members).
 */
export function useUserDepartment() {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery({
    queryKey: ["user-department-membership", user?.id, tid],
    enabled: !!user?.id && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_department_members")
        .select("department_id")
        .eq("user_id", user!.id)
        .eq("tenant_id", tid!)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.department_id as string | null;
    },
  });
}
