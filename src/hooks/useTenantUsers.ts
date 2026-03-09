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
      const { data, error } = await supabase
        .rpc("get_tenant_users_with_email", { p_tenant_id: tenantId! });
      if (error) throw error;
      return (data ?? []) as TenantProfile[];
    },
  });
}

export function useTenantInvites() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const tf = (q: any) => tid ? q.eq("tenant_id", tid) : q;
  return useQuery<TenantInvite[]>({
    queryKey: ["tenant-invites", tid],
    queryFn: async () => {
      const { data, error } = await tf(
        supabase
          .from("invites")
          .select("*")
          .is("used_at", null)
          .gte("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(50)
      );
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
  const { profile } = useAuth();
  return useMutation({
    mutationFn: async ({ email, role, tenantId }: { email: string; role: string; tenantId: string }) => {
      const normalizedEmail = email.trim().toLowerCase();
      const emailDomain = normalizedEmail.split("@")[1] ?? "";
      const allowedDomain = (profile?.allowed_domain ?? "").toLowerCase();
      const accessStatus = allowedDomain && emailDomain === allowedDomain ? "active" : "pending";

      // 1. Create invite record
      const { error: invErr } = await supabase
        .from("invites")
        .insert({ email: normalizedEmail, role, tenant_id: tenantId });
      if (invErr) throw invErr;

      // 2. Audit event
      const { error: auditErr } = await supabase
        .from("audit_events")
        .insert({
          tenant_id: tenantId,
          actor_user_id: profile?.user_id,
          event_type: "INVITE_SENT",
          metadata: { email: normalizedEmail, role, access_status: accessStatus, allowed_domain: allowedDomain },
        });
      if (auditErr) console.error("Audit error:", auditErr);

      return { accessStatus };
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
