import { createContext, useContext, useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

interface TenantOption {
  id: string;
  nome: string;
}

interface TenantFilterContextValue {
  /** null = show all (no filter) */
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  tenants: TenantOption[];
  tenantsLoading: boolean;
  isSuperAdmin: boolean;
  /** The effective tenant_id to use in queries. null = don't filter (normal user or "Todos"). */
  effectiveTenantId: string | null;
}

const TenantFilterContext = createContext<TenantFilterContextValue | undefined>(undefined);

const STORAGE_KEY = "super-admin-tenant-filter";

export function TenantFilterProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.is_super_admin === true;
  const queryClient = useQueryClient();

  const [selectedTenantId, setSelectedTenantIdRaw] = useState<string | null>(() => {
    // Non-super-admins: defensively clear any stale tenant filter from a previous session
    if (!isSuperAdmin) {
      try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
      return null;
    }
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY);
      // Default to admin's own tenant if nothing stored
      return stored || profile?.tenant_id || null;
    } catch {
      return profile?.tenant_id || null;
    }
  });

  const setSelectedTenantId = useCallback((id: string | null) => {
    setSelectedTenantIdRaw(id);
    try {
      if (id) sessionStorage.setItem(STORAGE_KEY, id);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {}
    // Invalidate all queries so they refetch with new tenant context
    queryClient.invalidateQueries();
  }, [queryClient]);

  const { data: tenants = [], isLoading: tenantsLoading } = useQuery<TenantOption[]>({
    queryKey: ["tenants-list-super"],
    enabled: isSuperAdmin,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return data ?? [];
    },
  });

  // For super admins with a selected tenant, pass the tenant_id to queries
  // For normal users, always pass their own tenant_id for query performance
  // (RLS still enforces security, but explicit filter helps DB use indexes)
  const effectiveTenantId = isSuperAdmin ? selectedTenantId : (profile?.tenant_id || null);

  const value = useMemo(() => ({
    selectedTenantId: isSuperAdmin ? selectedTenantId : null,
    setSelectedTenantId,
    tenants,
    tenantsLoading,
    isSuperAdmin,
    effectiveTenantId,
  }), [selectedTenantId, setSelectedTenantId, tenants, tenantsLoading, isSuperAdmin, effectiveTenantId]);

  return (
    <TenantFilterContext.Provider value={value}>
      {children}
    </TenantFilterContext.Provider>
  );
}

export function useTenantFilter() {
  const context = useContext(TenantFilterContext);
  if (!context) {
    throw new Error("useTenantFilter must be used within a TenantFilterProvider");
  }
  return context;
}

/**
 * Helper: applies .eq('tenant_id', tenantId) to a Supabase query if a tenant is selected.
 * Use this in query hooks to scope data for super admin tenant simulation.
 */
export function applyTenantFilter<T extends { eq: (col: string, val: any) => T }>(
  query: T,
  tenantId: string | null
): T {
  if (tenantId) {
    return query.eq("tenant_id", tenantId);
  }
  return query;
}
