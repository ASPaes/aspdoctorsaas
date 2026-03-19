import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

/**
 * Returns the department_id the current user belongs to
 * by following profiles.funcionario_id → funcionarios.department_id.
 * This is the canonical source of truth for department membership.
 */
export function useUserDepartment() {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const funcionarioId = profile?.funcionario_id;

  return useQuery<string | null>({
    queryKey: ["user-department-via-funcionario", user?.id, tid, funcionarioId],
    enabled: !!user?.id && !!tid && !!funcionarioId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("funcionarios")
        .select("department_id")
        .eq("id", funcionarioId!)
        .eq("tenant_id", tid!)
        .maybeSingle();
      if (error) throw error;
      return (data?.department_id as string | null) ?? null;
    },
  });
}
