import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface GroupParticipant {
  phone: string;
  name: string | null;
  admin: boolean;
  isLid?: boolean;
  lid?: string | null;
  isAll?: boolean; // synthetic entry for the "todos" (mentionsEveryOne) option
}

export interface GroupData {
  group_name: string | null;
  participant_count: number | null;
  participants: GroupParticipant[];
}

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
      const [rosterRes, namesRes] = await Promise.all([
        (supabase as any)
          .from("whatsapp_groups")
          .select("participants, group_name, participant_count")
          .eq("group_jid", groupJid)
          .eq("instance_id", instanceId)
          .maybeSingle(),
        (supabase as any)
          .from("whatsapp_group_participants")
          .select("phone, lid, push_name")
          .eq("group_jid", groupJid)
          .eq("instance_id", instanceId),
      ]);
      if (rosterRes.error) throw rosterRes.error;
      return {
        roster: rosterRes.data as { group_name: string | null; participant_count: number | null; participants: any } | null,
        names: namesRes.error ? [] : ((namesRes.data ?? []) as Array<{ phone: string | null; lid: string | null; push_name: string | null }>),
      };
    },
  });

  const participants: GroupParticipant[] = useMemo(() => {
    const roster = query.data?.roster;
    if (!roster?.participants) return [];
    let parsed: any;
    try {
      parsed = typeof roster.participants === "string" ? JSON.parse(roster.participants) : roster.participants;
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];

    const nameByKey = new Map<string, string>();
    for (const n of (query.data?.names ?? [])) {
      if (!n?.push_name) continue;
      if (n.phone) nameByKey.set(String(n.phone), n.push_name);
      if (n.lid) nameByKey.set(String(n.lid), n.push_name);
    }

    return (parsed as GroupParticipant[]).map((p) => {
      if (p.name && p.name.trim()) return p;
      const nm = (p.phone && nameByKey.get(String(p.phone))) || (p.lid && nameByKey.get(String(p.lid))) || null;
      return nm ? { ...p, name: nm } : p;
    });
  }, [query.data]);

  return { groupData: query.data?.roster ?? null, participants, isLoading: query.isLoading };
}
