import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type MuteDuration = "1h" | "8h" | "24h" | "forever";

interface MuteRow {
  conversation_id: string;
  muted_until: string | null;
}

export function useConversationMute(conversationId: string | null | undefined) {
  const { user } = useAuth();
  const uid = user?.id;
  const queryClient = useQueryClient();

  const queryKey = ["conversation-mute", conversationId, uid];

  const { data } = useQuery<MuteRow | null>({
    queryKey,
    enabled: !!uid && !!conversationId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data } = await supabase
        .from("notification_conversation_mute" as any)
        .select("conversation_id, muted_until")
        .eq("user_id", uid!)
        .eq("conversation_id", conversationId!)
        .maybeSingle();
      return (data as MuteRow | null) ?? null;
    },
  });

  // Determine if currently muted (muted_until null = forever, otherwise check date)
  const now = Date.now();
  const isMuted =
    !!data &&
    (data.muted_until === null || new Date(data.muted_until).getTime() > now);
  const mutedUntil = data?.muted_until ?? null;

  const muteMutation = useMutation({
    mutationFn: async (duration: MuteDuration) => {
      if (!conversationId) throw new Error("No conversation id");
      const { error } = await supabase.rpc("mute_conversation" as any, {
        p_conversation_id: conversationId,
        p_duration: duration,
      });
      if (error) throw error;
      return duration;
    },
    onSuccess: (duration) => {
      queryClient.invalidateQueries({ queryKey });
      const labels: Record<MuteDuration, string> = {
        "1h": "1 hora",
        "8h": "8 horas",
        "24h": "24 horas",
        forever: "sempre",
      };
      toast.success(`Conversa silenciada por ${labels[duration]}`);
    },
    onError: () => toast.error("Erro ao silenciar conversa"),
  });

  const unmuteMutation = useMutation({
    mutationFn: async () => {
      if (!conversationId) throw new Error("No conversation id");
      const { error } = await supabase.rpc("unmute_conversation" as any, {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Notificações reativadas");
    },
    onError: () => toast.error("Erro ao reativar notificações"),
  });

  return {
    isMuted,
    mutedUntil,
    mute: (d: MuteDuration) => muteMutation.mutate(d),
    unmute: () => unmuteMutation.mutate(),
    isPending: muteMutation.isPending || unmuteMutation.isPending,
  };
}
