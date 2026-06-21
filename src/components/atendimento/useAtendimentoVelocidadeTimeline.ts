import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";

export interface VelocidadeTimelinePoint {
  bucket: string;
  volume: number;
  sla_total: number;
  sla_dentro: number;
  sla_pct: number | null;
  tme_p50: number | null;
  frt_p50: number | null;
  tmr_p50: number | null;
}

export function useAtendimentoVelocidadeTimeline(
  dateRange: { from: Date; to: Date },
  slaSeconds: number,
  bucket: "day" | "week",
) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  return useQuery<VelocidadeTimelinePoint[]>({
    queryKey: [
      "atendimento-velocidade-timeline",
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      slaSeconds,
      bucket,
      selectedUnidadeId,
    ],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_velocidade_timeline", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_bucket: bucket,
        p_sla_frt_seconds: slaSeconds,
        p_unidade_base_id: selectedUnidadeId ?? null,
      });
      if (error) throw error;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return ((data ?? []) as any[]).map((r) => ({
        bucket: String(r.bucket),
        volume: Number(r.volume ?? 0),
        sla_total: Number(r.sla_total ?? 0),
        sla_dentro: Number(r.sla_dentro ?? 0),
        sla_pct: num(r.sla_pct),
        tme_p50: num(r.tme_p50),
        frt_p50: num(r.frt_p50),
        tmr_p50: num(r.tmr_p50),
      }));
    },
  });
}
