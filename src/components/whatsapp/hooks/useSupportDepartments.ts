import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface SupportDepartment {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  is_default_fallback: boolean;
  default_instance_id: string | null;
  tenant_id: string;
}

export function useSupportDepartments() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<SupportDepartment[]>({
    queryKey: ["support_departments", tid],
    queryFn: async () => {
      // Fora os setores que existem só para segurar uma opção de autoatendimento
      // da URA: ninguém trabalha neles, então não entram em filtro nem em
      // seletor de operação.
      let q = supabase
        .from("support_departments")
        .select("*")
        .eq("is_active", true)
        .neq("ura_action", "auto_reply")
        .order("name");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SupportDepartment[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useDepartmentInstances(departmentId: string | null) {
  return useQuery<string[]>({
    queryKey: ["support_department_instances_ids", departmentId],
    enabled: !!departmentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_department_instances")
        .select("instance_id")
        .eq("department_id", departmentId!)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []).map((d) => d.instance_id);
    },
    staleTime: 5 * 60 * 1000,
  });
}
