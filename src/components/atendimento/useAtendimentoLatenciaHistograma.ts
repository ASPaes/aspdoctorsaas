import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface FaixaHist { idx: number; faixa: string; qtd: number; }
export interface LatenciaHistograma { total: number; mediana_s: number | null; faixas: FaixaHist[]; }

export function useAtendimentoLatenciaHistograma() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { dateRange, departmentId, agentId, tipoAtendimento } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === 'all' ? null : tipoAtendimento === 'group';
  return useQuery({
    queryKey: ["atendimento-latencia-histograma", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), departmentId, agentId, tipoAtendimento],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_latencia_histograma", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_department_id: departmentId ?? null,
        p_agent_id: agentId ?? null,
        p_is_group: pIsGroup,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      return {
        total: Number(d.total ?? 0),
        mediana_s: d.mediana_s === null || d.mediana_s === undefined ? null : Number(d.mediana_s),
        faixas: ((d.faixas ?? []) as any[]).map((f) => ({
          idx: Number(f.idx),
          faixa: String(f.faixa),
          qtd: Number(f.qtd ?? 0),
        })),
      } as LatenciaHistograma;
    },
  });
}
