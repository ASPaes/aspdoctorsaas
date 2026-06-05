import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const LATEST_RELEASE_URL =
  "https://luucsmybijcaejhfiwwr.supabase.co/functions/v1/latest-release";

export function useReleasesNovidade() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const latestQuery = useQuery({
    queryKey: ["latest-release-ds"],
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<string | null> => {
      try {
        const res = await fetch(LATEST_RELEASE_URL);
        if (!res.ok) return null;
        const data = await res.json();
        return (data?.ultima_data_publicacao as string | null) ?? null;
      } catch {
        return null;
      }
    },
  });

  const vistoQuery = useQuery({
    queryKey: ["releases-visto-em", user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<string | null> => {
      const { data } = await (supabase.from("profiles") as any)
        .select("releases_visto_em")
        .eq("user_id", user!.id)
        .maybeSingle();
      return (data?.releases_visto_em as string | null) ?? null;
    },
  });

  const ultimaData = latestQuery.data ?? null;
  const vistoEm = vistoQuery.data ?? null;
  const temNovo =
    !!ultimaData &&
    (!vistoEm ||
      new Date(ultimaData).getTime() > new Date(vistoEm).getTime());

  const marcarVisto = async () => {
    if (!user?.id) return;
    await (supabase.from("profiles") as any)
      .update({ releases_visto_em: new Date().toISOString() })
      .eq("user_id", user.id);
    queryClient.invalidateQueries({ queryKey: ["releases-visto-em", user.id] });
  };

  return { temNovo, marcarVisto, ultimaData };
}
