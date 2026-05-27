import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type PermissionAction = "view" | "insert" | "update" | "delete";

export interface PermissionRow {
  resource_key: string;
  module: string;
  label: string;
  can_view: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
}

export interface PermissionMap {
  [resourceKey: string]: {
    view: boolean;
    insert: boolean;
    update: boolean;
    delete: boolean;
  };
}

export function usePermissions() {
  const { profile, user } = useAuth();
  const enabled = !!user?.id;

  const query = useQuery<PermissionMap>({
    queryKey: ["my-permissions", user?.id, profile?.tenant_id, profile?.role],
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<PermissionMap> => {
      const { data, error } = await (supabase.rpc as any)("get_my_permissions");
      if (error) throw error;
      const rows = (data ?? []) as PermissionRow[];
      const map: PermissionMap = {};
      for (const r of rows) {
        map[r.resource_key] = {
          view: r.can_view,
          insert: r.can_insert,
          update: r.can_update,
          delete: r.can_delete,
        };
      }
      return map;
    },
  });

  const can = (resource: string, action: PermissionAction): boolean => {
    if (profile?.is_super_admin) return true;
    if (query.isLoading) return true;
    return query.data?.[resource]?.[action] ?? false;
  };

  return {
    can,
    permissions: query.data,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
