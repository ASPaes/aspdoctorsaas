import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { buildLookup } from "../chat/mentionUtils";
import type { GroupParticipant } from "./useGroupParticipants";

export function useGroupMentionLookup() {
  const { effectiveTenantId } = useTenantFilter();

  const query = useQuery({
    queryKey: ["whatsapp-groups-mention-lookup", effectiveTenantId],
    enabled: !!effectiveTenantId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const [groupsRes, namesRes] = await Promise.all([
        (supabase.from("whatsapp_groups" as any) as any).select("participants").eq("tenant_id", effectiveTenantId),
        (supabase.from("whatsapp_group_participants" as any) as any).select("phone, lid, push_name").eq("tenant_id", effectiveTenantId),
      ]);
      if (groupsRes.error) throw groupsRes.error;
      return {
        rows: (groupsRes.data ?? []) as Array<{ participants: any }>,
        names: namesRes.error ? [] : ((namesRes.data ?? []) as Array<{ phone: string | null; lid: string | null; push_name: string | null }>),
      };
    },
  });

  const lookup = useMemo(() => {
    const nameByKey = new Map<string, string>();
    for (const n of (query.data?.names ?? [])) {
      if (!n?.push_name) continue;
      if (n.phone) nameByKey.set(String(n.phone), n.push_name);
      if (n.lid) nameByKey.set(String(n.lid), n.push_name);
    }

    const all: GroupParticipant[] = [];
    for (const row of query.data?.rows ?? []) {
      const raw = row?.participants;
      if (!raw) continue;
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!Array.isArray(parsed)) continue;
        for (const p of parsed as GroupParticipant[]) {
          if (p.name && p.name.trim()) { all.push(p); continue; }
          const nm = (p.phone && nameByKey.get(String(p.phone))) || (p.lid && nameByKey.get(String(p.lid))) || null;
          all.push(nm ? { ...p, name: nm } : p);
        }
      } catch {
        // ignore malformed row
      }
    }
    return buildLookup(all);
  }, [query.data]);

  return { lookup, isLoading: query.isLoading };
}
