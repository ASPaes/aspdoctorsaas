import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { readStoredAccent } from "@/lib/accentColor";

export interface UserPreferences {
  signature_name: string | null;
  sound_enabled: boolean;
  visual_notifications_enabled: boolean;
  /** Bip quando entra cliente na fila de atendimento (DEM-0203) */
  queue_sound_enabled: boolean;
  /** Volume do bip da fila, 0-100 */
  queue_sound_volume: number;
  /** Hex da cor de destaque; `null` = verde padrão da marca (DEM-0103) */
  theme_primary_color: string | null;
}

const DEFAULT_PREFS: UserPreferences = {
  signature_name: null,
  sound_enabled: true,
  visual_notifications_enabled: true,
  queue_sound_enabled: true,
  queue_sound_volume: 70,
  theme_primary_color: null,
};

/**
 * `theme_primary_color` é novo (DEM-0103) e o banco local roda com a estrutura
 * congelada da produção do dia em que foi clonado. Se a coluna não existir,
 * PostgREST devolve 42703 — a gente relê sem ela e desliga a escrita, em vez de
 * derrubar TODAS as preferências do usuário por causa de uma.
 */
let themeColumnAvailable = true;

const QUEUE_COLS = "queue_sound_enabled, queue_sound_volume";

/**
 * As colunas da fila são lidas direto da tabela, não pela RPC `get_my_preferences`
 * — a RPC tem lista fixa de colunas e recriá-la para incluir duas novas seria
 * mexer num SECURITY DEFINER em produção sem necessidade.
 */
async function fetchTablePrefs(tid: string, userId: string) {
  const run = (cols: string) =>
    (supabase.from("user_preferences") as any)
      .select(cols)
      .eq("tenant_id", tid)
      .eq("user_id", userId)
      .is("department_id", null)
      .maybeSingle();

  let { data, error } = themeColumnAvailable
    ? await run(`${QUEUE_COLS}, theme_primary_color`)
    : await run(QUEUE_COLS);

  if (error?.code === "42703") {
    themeColumnAvailable = false;
    ({ data, error } = await run(QUEUE_COLS));
  }
  if (error) throw error;

  return {
    queue_sound_enabled: data?.queue_sound_enabled ?? DEFAULT_PREFS.queue_sound_enabled,
    queue_sound_volume: data?.queue_sound_volume ?? DEFAULT_PREFS.queue_sound_volume,
    // Sem a coluna, o espelho local É a fonte — senão o sync leria `null` e
    // apagaria a cor escolhida a cada reload.
    theme_primary_color: themeColumnAvailable
      ? (data?.theme_primary_color ?? DEFAULT_PREFS.theme_primary_color)
      : readStoredAccent(),
  };
}

export function useUserPreferences() {
  const { user } = useAuth();
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();

  const {
    data: preferences,
    isLoading,
    isSuccess,
  } = useQuery<UserPreferences>({
    queryKey: ["userPreferences", tid],
    enabled: !!user && !!tid,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [rpcRes, tablePrefs] = await Promise.all([
        supabase.rpc("get_my_preferences" as any),
        fetchTablePrefs(tid!, user!.id),
      ]);

      const { data, error } = rpcRes;
      if (error) throw error;
      if (!data || (Array.isArray(data) && data.length === 0)) {
        return { ...DEFAULT_PREFS, ...tablePrefs };
      }
      const row = Array.isArray(data) ? data[0] : data;
      return {
        signature_name: row.signature_name ?? null,
        sound_enabled: row.sound_enabled ?? true,
        visual_notifications_enabled: row.visual_notifications_enabled ?? true,
        ...tablePrefs,
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

      const payload: Record<string, unknown> = {
        signature_name: prefs.signature_name ?? null,
        sound_enabled: prefs.sound_enabled ?? DEFAULT_PREFS.sound_enabled,
        visual_notifications_enabled:
          prefs.visual_notifications_enabled ?? DEFAULT_PREFS.visual_notifications_enabled,
        queue_sound_enabled: prefs.queue_sound_enabled ?? DEFAULT_PREFS.queue_sound_enabled,
        queue_sound_volume: prefs.queue_sound_volume ?? DEFAULT_PREFS.queue_sound_volume,
      };
      // Só entra no payload se a coluna existir no ambiente (ver `themeColumnAvailable`).
      if (themeColumnAvailable && "theme_primary_color" in prefs) {
        payload.theme_primary_color = prefs.theme_primary_color ?? null;
      }

      // `as any`: `theme_primary_color` ainda não está no types.ts gerado.
      const table = supabase.from("user_preferences") as any;

      if (existing?.id) {
        const { error } = await table
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await table.insert({
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
    /** `false` enquanto o banco não respondeu — inclusive com a query desabilitada. */
    isLoaded: isSuccess,
    upsert: upsertMutation.mutate,
    upsertAsync: upsertMutation.mutateAsync,
    isUpdating: upsertMutation.isPending,
  };
}
