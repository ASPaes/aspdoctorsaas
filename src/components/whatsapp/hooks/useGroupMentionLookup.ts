import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { buildLookup } from "../chat/mentionUtils";
import type { GroupParticipant } from "./useGroupParticipants";

/**
 * Busca participants de TODOS os whatsapp_groups do tenant e monta um único
 * lookup (JID/phone -> display) via buildLookup. Uma query por tenant,
 * deduplicada pelo react-query.
 */
export function useGroupMentionLookup() {
  const { effectiveTenantId } = useTenantFilter();

  const query = useQuery({
    queryKey: ["whatsapp-groups-mention-lookup", effectiveTenantId],
    enabled: !!effectiveTenantId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase.from("whatsapp_groups" as any) as any)
        .select("participants")
        .eq("tenant_id", effectiveTenantId);
      if (error) throw error;
      return (data ?? []) as Array<{ participants: any }>;
    },
  });

  const lookup = useMemo(() => {
    const all: GroupParticipant[] = [];
    for (const row of query.data ?? []) {
      const raw = row?.participants;
      if (!raw) continue;
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (Array.isArray(parsed)) all.push(...(parsed as GroupParticipant[]));
      } catch {
        // ignore malformed row
      }
    }
    return buildLookup(all);
  }, [query.data]);

  return { lookup, isLoading: query.isLoading };
}
