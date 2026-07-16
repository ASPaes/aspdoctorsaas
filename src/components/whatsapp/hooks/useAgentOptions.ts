import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantUsers } from "@/hooks/useTenantUsers";

export interface AgentOption {
  userId: string;
  label: string;
}

export function useAgentOptions() {
  const { data: tenantUsers } = useTenantUsers();

  const tenantUsersKey = (tenantUsers ?? [])
    .map((u) => `${u.user_id}:${u.funcionario_id ?? ""}:${u.status}`)
    .join(",");

  return useQuery<AgentOption[]>({
    queryKey: ["whatsapp-agent-options", tenantUsersKey],
    enabled: !!tenantUsers && tenantUsers.length > 0,
    queryFn: async () => {
      if (!tenantUsers) return [];

      const funcIds = tenantUsers
        .filter((u) => u.funcionario_id && u.status === "ativo")
        .map((u) => u.funcionario_id!);

      if (funcIds.length === 0) {
        return tenantUsers
          .filter((u) => u.status === "ativo")
          .map((u) => ({
            userId: u.user_id,
            label: u.email,
          }));
      }

      const { data: funcs } = await supabase
        .from("funcionarios")
        .select("id, nome")
        .in("id", funcIds);

      const funcMap = new Map((funcs ?? []).map((f) => [f.id, f.nome]));

      return tenantUsers
        .filter((u) => u.status === "ativo")
        .map((u) => ({
          userId: u.user_id,
          label: u.funcionario_id ? funcMap.get(u.funcionario_id) || u.email : u.email,
        }));
    },
  });
}
