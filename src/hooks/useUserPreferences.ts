import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface UserPreferences {
  signature_name: string | null;
  sound_enabled: boolean;
  visual_notifications_enabled: boolean;
}

const DEFAULT_PREFS: UserPreferences = {
  signature_name: null,
  sound_enabled: true,
  visual_notifications_enabled: true,
};

export function useUserPreferences() {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["userPreferences", tid],
    enabled: !!user && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_my_preferences" as any);
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) return DEFAULT_PREFS;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        signature_name: row.signature_name ?? null,
        sound_enabled: row.sound_enabled ?? true,
        visual_notifications_enabled: row.visual_notifications_enabled ?? true,
      };
    },
  });

  const upsertMutation = useMutation({
    mutationFn: async (prefs: Partial<UserPreferences>) => {
      if (!user || !tid) throw new Error("Not authenticated");

      const { data: existing } = await supabase
        .from("user_preferences")
        .select("id")
        .eq("tenant_id", tid)
        .eq("user_id", user.id)
        .is("department_id", null)
        .maybeSingle();

      if (existing?.id) {
        const { error } = await supabase
          .from("user_preferences")
          .update({
            signature_name: prefs.signature_name,
            sound_enabled: prefs.sound_enabled,
            visual_notifications_enabled: prefs.visual_notifications_enabled,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_preferences").insert({
          tenant_id: tid,
          user_id: user.id,
          department_id: null,
          signature_name: prefs.signature_name ?? null,
          sound_enabled: prefs.sound_enabled ?? true,
          visual_notifications_enabled: prefs.visual_notifications_enabled ?? true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userPreferences", tid] });
    },
  });

  return {
    preferences: preferences ?? DEFAULT_PREFS,
    isLoading,
    upsert: upsertMutation.mutate,
    upsertAsync: upsertMutation.mutateAsync,
    isUpdating: upsertMutation.isPending,
  };
}
