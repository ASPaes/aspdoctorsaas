import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Message {
  id: string;
  conversation_id: string;
  message_id: string;
  remote_jid: string;
  content: string;
  message_type: string;
  media_url: string | null;
  media_mimetype: string | null;
  media_path: string | null;
  media_filename: string | null;
  media_ext: string | null;
  media_size_bytes: number | null;
  media_kind: string | null;
  status: string;
  is_from_me: boolean;
  timestamp: string;
  quoted_message_id: string | null;
  metadata: Record<string, any> | null;
}

export function useMessages(conversationId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery<Message[]>({
    queryKey: ["whatsapp-messages", conversationId],
    enabled: !!conversationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_messages" as any)
        .select("*")
        .eq("conversation_id", conversationId!)
        .order("timestamp", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as Message[];
    },
    staleTime: 15_000,
  });

  // Realtime for new messages
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`messages-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "whatsapp_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", conversationId] });
          queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, queryClient]);

  return query;
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ conversationId, content }: { conversationId: string; content: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Não autenticado");

      const res = await supabase.functions.invoke("send-whatsapp-message", {
        body: { conversationId, content, messageType: "text" },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (res.error) throw res.error;
      if (!res.data?.success) throw new Error(res.data?.error || "Erro ao enviar");
      return res.data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", vars.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
    },
  });
}
