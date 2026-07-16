import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface AgentOption {
  userId: string;
  label: string;
}

export function useAgentOptions() {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<AgentOption[]>({
    queryKey: ["whatsapp-agent-options", tid],
    enabled: !!tid,
    staleTime: 300_000,
    queryFn: async () => {
      if (!tid) return [];

      const { data, error } = await (supabase.rpc as any)("get_tenant_agent_names", {
        p_tenant_id: tid,
      });

      if (error) throw error;

      return (data ?? []).map((r: any) => ({
        userId: r.user_id,
        label: r.nome || "Operador",
      }));
    },
  });
}
