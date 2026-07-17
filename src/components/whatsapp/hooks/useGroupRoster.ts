import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GroupParticipant {
  id: string;
  admin: 'superadmin' | 'admin' | null;
  phone: string | null;
  name: string | null;
}

export interface GroupRoster {
  providerType: string;
  participants: GroupParticipant[];
  selfId: string | null;
  selfIsAdmin: boolean;
  selfResolved: boolean;
  groupName: string | null;
}

export function useGroupRoster(conversationId: string | null | undefined, enabled = true) {
  return useQuery<GroupRoster | null>({
    queryKey: ["group-roster", conversationId],
    enabled: enabled && !!conversationId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("get-group-participants", {
        body: { conversationId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Falha ao carregar participantes");
      return {
        providerType: String(data.providerType ?? ""),
        participants: (data.participants ?? []) as GroupParticipant[],
        selfId: data.selfId ?? null,
        selfIsAdmin: !!data.selfIsAdmin,
        selfResolved: !!data.selfResolved,
        groupName: data.groupName ?? null,
      };
    },
  });
}
