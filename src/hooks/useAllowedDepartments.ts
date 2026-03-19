import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface AllowedDepartment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  is_default_fallback: boolean;
  default_instance_id: string | null;
  tenant_id: string;
}

/**
 * Returns the departments the current user is allowed to see:
 * - admin / head / super_admin: all active departments in the tenant
 * - regular user: only the single department from funcionarios.department_id
 */
export function useAllowedDepartments() {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();

  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;
  const funcionarioId = profile?.funcionario_id;

  return useQuery<AllowedDepartment[]>({
    queryKey: ["allowed_departments", tid, user?.id, isAdmin, funcionarioId],
    enabled: !!user?.id && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (isAdmin) {
        const { data, error } = await supabase
          .from("support_departments")
          .select("id, name, slug, description, is_active, is_default_fallback, default_instance_id, tenant_id")
          .eq("tenant_id", tid!)
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        return (data ?? []) as AllowedDepartment[];
      }

      // Regular user: get department from funcionarios.department_id
      if (!funcionarioId) return [];

      const { data: func } = await supabase
        .from("funcionarios")
        .select("department_id")
        .eq("id", funcionarioId)
        .eq("tenant_id", tid!)
        .maybeSingle();

      const deptId = func?.department_id;
      if (!deptId) return [];

      const { data, error } = await supabase
        .from("support_departments")
        .select("id, name, slug, description, is_active, is_default_fallback, default_instance_id, tenant_id")
        .eq("id", deptId)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      return data ? [data as AllowedDepartment] : [];
    },
  });
}
