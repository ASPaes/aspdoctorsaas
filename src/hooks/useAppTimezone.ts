import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

const DEFAULT_TZ = "America/Sao_Paulo";

export function useAppTimezone() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const queryClient = useQueryClient();

  const { data: timezone = DEFAULT_TZ, isLoading } = useQuery({
    queryKey: ["app_timezone", tid],
    queryFn: async () => {
      let q = supabase.from("configuracoes").select("chat_timezone");
      if (tid) q = q.eq("tenant_id", tid);
      const { data, error } = await q.limit(1).maybeSingle();
      if (error) throw error;
      return (data as any)?.chat_timezone ?? DEFAULT_TZ;
    },
    staleTime: 5 * 60 * 1000,
  });

  const updateTimezone = useMutation({
    mutationFn: async ({ configId, tz }: { configId: number; tz: string }) => {
      const { error } = await supabase
        .from("configuracoes")
        .update({ chat_timezone: tz } as any)
        .eq("id", configId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["app_timezone"] });
      queryClient.invalidateQueries({ queryKey: ["configuracoes"] });
    },
  });

  return { timezone, isLoading, updateTimezone };
}

/** @deprecated Use useAppTimezone instead */
export const useChatTimezone = useAppTimezone;
