import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface AttendanceSLAMetrics {
  total: number;
  closed: number;
  active: number;
  avgWaitSeconds: number;
  avgHandleSeconds: number;
  avgResolutionSeconds: number;
  avgFirstResponseSeconds: number;
  fcrCount: number;
  reopenedCount: number;
  resolutionRate: number;
  fcrRate: number;
  reopenRate: number;

  sector: {
    total: number;
    closed: number;
    active: number;
    avgWaitSeconds: number;
    avgHandleSeconds: number;
    avgResolutionSeconds: number;
    avgFirstResponseSeconds: number;
    fcrRate: number;
    resolutionRate: number;
  };

  agentRanking: Array<{
    agentId: string;
    totalAttendances: number;
    closedAttendances: number;
    avgResolutionSeconds: number;
    avgFirstResponseSeconds: number;
    fcrRate: number;
  }>;

  dailyTrend: Array<{ date: string; total: number; closed: number }>;
  hourlyActivity: Array<{ hour: number; total: number }>;
}

export interface AttendanceMetricsFilters {
  dateRange: { from: Date; to: Date };
  departmentId?: string | null;
  agentId?: string | null;
}

function parseStats(raw: any) {
  const total = Number(raw?.total ?? 0);
  const closed = Number(raw?.closed ?? 0);
  const active = Number(raw?.active ?? 0);
  const avgWaitSeconds = Math.round(Number(raw?.avg_wait_sec ?? 0));
  const avgHandleSeconds = Math.round(Number(raw?.avg_handle_sec ?? 0));
  const avgResolutionSeconds = Math.round(Number(raw?.avg_resolution_sec ?? 0));
  const avgFirstResponseSeconds = Math.round(Number(raw?.avg_first_response_sec ?? 0));
  const fcrCount = Number(raw?.fcr_count ?? 0);
  const reopenedCount = Number(raw?.reopened_count ?? 0);
  const resolutionRate = total > 0 ? (closed / total) * 100 : 0;
  const fcrRate = closed > 0 ? (fcrCount / closed) * 100 : 0;
  const reopenRate = total > 0 ? (reopenedCount / total) * 100 : 0;
  return {
    total, closed, active,
    avgWaitSeconds, avgHandleSeconds, avgResolutionSeconds, avgFirstResponseSeconds,
    fcrCount, reopenedCount, resolutionRate, fcrRate, reopenRate,
  };
}

function formatSecondsToDisplay(seconds: number): string {
  if (seconds <= 0) return "0 seg";
  if (seconds < 60) return `${seconds} seg`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export { formatSecondsToDisplay };

export function useAttendanceMetrics(filters: AttendanceMetricsFilters) {
  const { effectiveTenantId: tid } = useTenantFilter();

  return useQuery<AttendanceSLAMetrics>({
    queryKey: [
      "attendance-metrics",
      filters.dateRange.from.toISOString(),
      filters.dateRange.to.toISOString(),
      filters.departmentId,
      filters.agentId,
      tid,
    ],
    enabled: !!tid && !!filters.dateRange.from && !!filters.dateRange.to,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_attendance_metrics" as any,
        {
          p_tenant_id: tid,
          p_from: filters.dateRange.from.toISOString(),
          p_to: filters.dateRange.to.toISOString(),
          p_department_id: filters.departmentId || null,
          p_agent_id: filters.agentId || null,
        }
      );
      if (error) throw error;

      const raw = data as any;
      const agentStats = parseStats(raw?.agent);
      const sectorRaw = parseStats(raw?.sector);

      const agentRanking = ((raw?.agentRanking ?? []) as any[]).map((r: any) => {
        const closed = Number(r.closed_attendances ?? 0);
        const fcr = Number(r.fcr_count ?? 0);
        return {
          agentId: r.assigned_to,
          totalAttendances: Number(r.total_attendances ?? 0),
          closedAttendances: closed,
          avgResolutionSeconds: Math.round(Number(r.avg_resolution_sec ?? 0)),
          avgFirstResponseSeconds: Math.round(Number(r.avg_first_response_sec ?? 0)),
          fcrRate: closed > 0 ? (fcr / closed) * 100 : 0,
        };
      });

      const dailyTrend = ((raw?.dailyTrend ?? []) as any[]).map((d: any) => ({
        date: d.day,
        total: Number(d.total ?? 0),
        closed: Number(d.closed ?? 0),
      }));

      const hourlyActivity = ((raw?.hourly ?? []) as any[]).map((h: any) => ({
        hour: Number(h.hour ?? 0),
        total: Number(h.total ?? 0),
      }));

      return {
        ...agentStats,
        sector: {
          total: sectorRaw.total,
          closed: sectorRaw.closed,
          active: sectorRaw.active,
          avgWaitSeconds: sectorRaw.avgWaitSeconds,
          avgHandleSeconds: sectorRaw.avgHandleSeconds,
          avgResolutionSeconds: sectorRaw.avgResolutionSeconds,
          avgFirstResponseSeconds: sectorRaw.avgFirstResponseSeconds,
          fcrRate: sectorRaw.fcrRate,
          resolutionRate: sectorRaw.resolutionRate,
        },
        agentRanking,
        dailyTrend,
        hourlyActivity,
      };
    },
  });
}
