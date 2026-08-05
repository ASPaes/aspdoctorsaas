import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface UserPreferences {
  signature_name: string | null;
  sound_enabled: boolean;
  visual_notifications_enabled: boolean;
  /** Bip quando entra cliente na fila de atendimento (DEM-0203) */
  queue_sound_enabled: boolean;
  /** Volume do bip da fila, 0-100 */
  queue_sound_volume: number;
}

const DEFAULT_PREFS: UserPreferences = {
  signature_name: null,
  sound_enabled: true,
  visual_notifications_enabled: true,
  queue_sound_enabled: true,
  queue_sound_volume: 70,
};

/**
 * As colunas da fila são lidas direto da tabela, não pela RPC `get_my_preferences`
 * — a RPC tem lista fixa de colunas e recriá-la para incluir duas novas seria
 * mexer num SECURITY DEFINER em produção sem necessidade.
 */
async function fetchQueuePrefs(tid: string, userId: string) {
  const { data, error } = await supabase
    .from("user_preferences")
    .select("queue_sound_enabled, queue_sound_volume")
    .eq("tenant_id", tid)
    .eq("user_id", userId)
    .is("department_id", null)
    .maybeSingle();
  if (error) throw error;
  return {
    queue_sound_enabled: data?.queue_sound_enabled ?? DEFAULT_PREFS.queue_sound_enabled,
    queue_sound_volume: data?.queue_sound_volume ?? DEFAULT_PREFS.queue_sound_volume,
  };
}

export function useUserPreferences() {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();

  const { data: preferences, isLoading } = useQuery<UserPreferences>({
    queryKey: ["userPreferences", tid],
    enabled: !!user && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [rpcRes, queuePrefs] = await Promise.all([
        supabase.rpc("get_my_preferences" as any),
        fetchQueuePrefs(tid!, user!.id),
      ]);

      const { data, error } = rpcRes;
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return { ...DEFAULT_PREFS, ...queuePrefs };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        signature_name: row.signature_name ?? null,
        sound_enabled: row.sound_enabled ?? true,
        visual_notifications_enabled: row.visual_notifications_enabled ?? true,
        ...queuePrefs,
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

      const payload = {
        signature_name: prefs.signature_name ?? null,
        sound_enabled: prefs.sound_enabled ?? DEFAULT_PREFS.sound_enabled,
        visual_notifications_enabled:
          prefs.visual_notifications_enabled ?? DEFAULT_PREFS.visual_notifications_enabled,
        queue_sound_enabled: prefs.queue_sound_enabled ?? DEFAULT_PREFS.queue_sound_enabled,
        queue_sound_volume: prefs.queue_sound_volume ?? DEFAULT_PREFS.queue_sound_volume,
      };

      if (existing?.id) {
        const { error } = await supabase
          .from("user_preferences")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("user_preferences").insert({
          tenant_id: tid,
          user_id: user.id,
          department_id: null,
          ...payload,
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
