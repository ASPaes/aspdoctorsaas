import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";

export interface CanalRow { canal: string; qtd: number; }
export interface HeatCell { dow: number; hora: number; qtd: number; }
export interface MotivoRow { tag: string; qtd: number; }
export interface AtendimentoVolume {
  total: number; novos: number; recorrentes: number;
  proativo: number; reativo: number;
  canais: CanalRow[]; heatmap: HeatCell[];
  top_motivos: MotivoRow[]; motivos_cobertura: number | null;
}

export function useAtendimentoVolume(dateRange: { from: Date; to: Date }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  return useQuery<AtendimentoVolume>({
    queryKey: ["atendimento-volume", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), selectedUnidadeId],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_volume", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_unidade_base_id: selectedUnidadeId ?? null,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        total: Number(d.total ?? 0),
        novos: Number(d.novos ?? 0),
        recorrentes: Number(d.recorrentes ?? 0),
        proativo: Number(d.proativo ?? 0),
        reativo: Number(d.reativo ?? 0),
        canais: ((d.canais ?? []) as any[]).map((r) => ({ canal: String(r.canal), qtd: Number(r.qtd ?? 0) })),
        heatmap: ((d.heatmap ?? []) as any[]).map((r) => ({ dow: Number(r.dow), hora: Number(r.hora), qtd: Number(r.qtd ?? 0) })),
        top_motivos: ((d.top_motivos ?? []) as any[]).map((r) => ({ tag: String(r.tag), qtd: Number(r.qtd ?? 0) })),
        motivos_cobertura: num(d.motivos_cobertura),
      } as AtendimentoVolume;
    },
  });
}
