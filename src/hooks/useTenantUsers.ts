import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TenantProfile {
  user_id: string;
  tenant_id: string;
  role: string;
  status: string;
  is_super_admin: boolean;
  created_at: string;
}

export interface TenantInvite {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
  tenant_id: string;
}

export interface TenantInfo {
  id: string;
  nome: string;
  plano: string | null;
  status: string;
  max_users: number;
  trial_ends_at: string | null;
  created_at: string;
}

export function useTenantInfo() {
  return useQuery<TenantInfo | null>({
    queryKey: ["tenant-info"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useTenantUsers() {
  const { profile } = useAuth();
  return useQuery<TenantProfile[]>({
    queryKey: ["tenant-users", profile?.tenant_id],
    enabled: !!profile?.tenant_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, tenant_id, role, status, is_super_admin, created_at")
        .eq("tenant_id", profile!.tenant_id)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useTenantInvites() {
  return useQuery<TenantInvite[]>({
    queryKey: ["tenant-invites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invites")
        .select("*")
        .is("used_at", null)
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ role })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-users"] }),
  });
}

export function useUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, status }: { userId: string; status: string }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ status })
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-users"] }),
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, role, tenantId }: { email: string; role: string; tenantId: string }) => {
      const { error } = await supabase
        .from("invites")
        .insert({ email, role, tenant_id: tenantId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-invites"] }),
  });
}

export function useCancelInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("invites")
        .delete()
        .eq("id", inviteId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-invites"] }),
  });
}
