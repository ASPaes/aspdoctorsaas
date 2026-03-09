import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SuperTenant {
  id: string;
  nome: string;
  plano: string | null;
  status: string;
  max_users: number;
  trial_ends_at: string | null;
  created_at: string;
  user_count?: number;
}

export function useSuperTenants() {
  return useQuery<SuperTenant[]>({
    queryKey: ["super-tenants"],
    queryFn: async () => {
      // Fetch tenants
      const { data: tenants, error } = await supabase
        .from("tenants")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;

      // Batch fetch user counts per tenant using RPC
      const tenantIds = (tenants ?? []).map((t) => t.id);
      const counts: Record<string, number> = {};
      // Use parallel calls for counts
      await Promise.all(
        tenantIds.map(async (tid) => {
          const { data } = await supabase.rpc("tenant_user_count", { p_tenant: tid });
          counts[tid] = (data as number) ?? 0;
        })
      );

      return (tenants ?? []).map((t) => ({
        ...t,
        user_count: counts[t.id] ?? 0,
      }));
    },
  });
}

export function useSuperTenantDetail(tenantId: string | undefined) {
  return useQuery({
    queryKey: ["super-tenant-detail", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const [tenantRes, usersRes, invitesRes] = await Promise.all([
        supabase.from("tenants").select("*").eq("id", tenantId!).single(),
        (supabase.rpc as any)("get_tenant_users_with_email", { p_tenant_id: tenantId! }),
        supabase
          .from("invites")
          .select("*")
          .eq("tenant_id", tenantId!)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (tenantRes.error) throw tenantRes.error;
      return {
        tenant: tenantRes.data as SuperTenant,
        users: (usersRes.data ?? []) as any[],
        invites: (invitesRes.data ?? []) as any[],
      };
    },
  });
}

export function useUpdateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      status?: string;
      max_users?: number;
      plano?: string;
    }) => {
      const { error } = await supabase.from("tenants").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["super-tenants"] });
      qc.invalidateQueries({ queryKey: ["super-tenant-detail"] });
    },
  });
}
