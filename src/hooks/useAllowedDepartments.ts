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
 * - admin / super_admin: all active departments in the tenant
 * - regular user: only departments where they have a membership in support_department_members
 */
export function useAllowedDepartments() {
  const { user, profile } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();

  const isAdmin = profile?.role === "admin" || profile?.role === "head" || profile?.is_super_admin;

  return useQuery<AllowedDepartment[]>({
    queryKey: ["allowed_departments", tid, user?.id, isAdmin],
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

      // Regular user: departments via membership + filter active departments
      const { data, error } = await supabase
        .from("support_department_members")
        .select(`
          department_id,
          support_departments!inner (
            id, name, slug, description, is_active, is_default_fallback, default_instance_id, tenant_id
          )
        `)
        .eq("tenant_id", tid!)
        .eq("user_id", user!.id)
        .eq("is_active", true)
        .eq("support_departments.is_active", true);

      if (error) throw error;

      const departments: AllowedDepartment[] = [];
      for (const row of data ?? []) {
        const dept = row.support_departments as unknown as AllowedDepartment;
        if (dept) {
          departments.push(dept);
        }
      }

      // Deduplicate
      const seen = new Set<string>();
      return departments.filter((d) => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
      });
    },
  });
}
