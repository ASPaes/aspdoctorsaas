import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useDepartmentFilter } from "@/contexts/DepartmentFilterContext";

export interface PillCount {
  total: number;
  aguardando: number;
  unread: number;
}

export type PillCountsMap = Record<
  "waiting" | "in_progress" | "after_hours" | "closed" | "all",
  PillCount
>;

const EMPTY: PillCount = { total: 0, aguardando: 0, unread: 0 };

const BUCKET_KEYS = ["waiting", "in_progress", "after_hours", "closed"] as const;
type BucketKey = (typeof BUCKET_KEYS)[number];

export function usePillCounts() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedDepartmentId } = useDepartmentFilter();

  return useQuery<PillCountsMap>({
    queryKey: ["whatsapp", "pill-counts", tid, selectedDepartmentId ?? null],
    enabled: !!tid,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("whatsapp_pill_counts", {
        p_tenant_id: tid,
        p_department_id: selectedDepartmentId ?? null,
      });
      if (error) throw error;

      const map: PillCountsMap = {
        waiting: { ...EMPTY },
        in_progress: { ...EMPTY },
        after_hours: { ...EMPTY },
        closed: { ...EMPTY },
        all: { ...EMPTY },
      };

      for (const row of (data ?? []) as Array<{
        bucket: string;
        total_conversas: number | string;
        aguardando: number | string;
        msgs_nao_lidas: number | string;
      }>) {
        const key = row.bucket as BucketKey;
        if (!BUCKET_KEYS.includes(key)) continue;
        map[key] = {
          total: Number(row.total_conversas) || 0,
          aguardando: Number(row.aguardando) || 0,
          unread: 0,
        };
      }

      const active: BucketKey[] = ["waiting", "in_progress", "after_hours"];
      map.all = active.reduce<PillCount>(
        (acc, k) => ({
          total: acc.total + map[k].total,
          aguardando: acc.aguardando + map[k].aguardando,
          unread: 0,
        }),
        { ...EMPTY }
      );

      return map;
    },
  });
}
