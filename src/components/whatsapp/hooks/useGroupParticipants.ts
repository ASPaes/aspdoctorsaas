import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GroupParticipant {
  phone: string;
  name: string | null;
  admin: boolean;
  isLid?: boolean;
  lid?: string | null;
}

export interface GroupData {
  group_name: string | null;
  participant_count: number | null;
  participants: GroupParticipant[];
}

/**
 * Busca os participantes de um grupo do WhatsApp.
 * Mesma queryKey usada pelo GroupParticipantsSheet, com staleTime de 10 min.
 */
export function useGroupParticipants(
  groupJid: string | null | undefined,
  instanceId: string | null | undefined,
  enabled = true,
) {
  const query = useQuery({
    queryKey: ["whatsapp-group-participants", groupJid, instanceId],
    enabled: enabled && !!groupJid && !!instanceId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_groups")
        .select("participants, group_name, participant_count")
        .eq("group_jid", groupJid)
        .eq("instance_id", instanceId)
        .maybeSingle();
      if (error) throw error;
      return data as {
        group_name: string | null;
        participant_count: number | null;
        participants: any;
      } | null;
    },
  });

  const participants: GroupParticipant[] = useMemo(() => {
    if (!query.data?.participants) return [];
    try {
      const parsed =
        typeof query.data.participants === "string"
          ? JSON.parse(query.data.participants)
          : query.data.participants;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [query.data?.participants]);

  return {
    groupData: query.data ?? null,
    participants,
    isLoading: query.isLoading,
  };
}
