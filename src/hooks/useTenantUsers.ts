import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface TenantProfile {
  user_id: string;
  email: string;
  tenant_id: string;
  role: string;
  status: string;
  is_super_admin: boolean;
  created_at: string;
  funcionario_id: number | null;
}

export interface TenantInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  invited_at: string;
  accepted_at: string | null;
  tenant_id: string;
  funcionario_id: number | null;
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
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const tenantId = tid || profile?.tenant_id;
  return useQuery<TenantInfo | null>({
    queryKey: ["tenant-info", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("*")
        .eq("id", tenantId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useTenantUsers() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { profile } = useAuth();
  const tenantId = tid || profile?.tenant_id;
  return useQuery<TenantProfile[]>({
    queryKey: ["tenant-users", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await (supabase
        .rpc as any)("get_tenant_users_with_email", { p_tenant_id: tenantId! });
      if (error) throw error;
      return (data ?? []) as TenantProfile[];
    },
  });
}

export function useTenantInvites() {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<TenantInvite[]>({
    queryKey: ["tenant-invites", tid],
    enabled: !!tid,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("access_invites")
        .select("id, email, status, invited_at, accepted_at, tenant_id, funcionario_id, metadata")
        .eq("tenant_id", tid!)
        .eq("status", "pending")
        .order("invited_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id,
        email: row.email,
        role: (row.metadata as any)?.role ?? "viewer",
        status: row.status,
        invited_at: row.invited_at,
        accepted_at: row.accepted_at,
        tenant_id: row.tenant_id,
        funcionario_id: row.funcionario_id,
      })) as TenantInvite[];
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

export function useUpdateUserFuncionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, funcionarioId }: { userId: string; funcionarioId: number | null }) => {
      const { error } = await supabase
        .from("profiles")
        .update({ funcionario_id: funcionarioId } as any)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-users"] }),
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ email, role, tenantId }: { email: string; role: string; tenantId: string }) => {
      const normalizedEmail = email.trim().toLowerCase();

      const { data, error: invErr } = await supabase
        .from("access_invites")
        .insert({
          email: normalizedEmail,
          tenant_id: tenantId,
          funcionario_id: null,
          invited_by: profile?.user_id,
          status: "pending",
          metadata: { role },
        })
        .select("id")
        .single();
      if (invErr) throw invErr;

      const { error: auditErr } = await supabase
        .from("audit_events")
        .insert({
          tenant_id: tenantId,
          actor_user_id: profile?.user_id,
          event_type: "INVITE_SENT",
          metadata: { email: normalizedEmail, role },
        });
      if (auditErr) console.error("Audit error:", auditErr);

      return { token: data.id };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-invites"] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
    },
  });
}

export function useDeleteTenantUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("profiles")
        .delete()
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-users"] }),
  });
}

export function useCancelInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase
        .from("access_invites")
        .delete()
        .eq("id", inviteId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tenant-invites"] }),
  });
}
