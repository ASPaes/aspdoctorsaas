import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface CanalRow { canal: string; qtd: number; }
/** Detalhe por atendimento da célula — só vem no modo plantão. */
export interface HeatDetalhe { hora: string; setor: string | null; fecha: string | null; }
export interface HeatCell { dow: number; hora: number; qtd: number; detalhes: HeatDetalhe[] | null; }
export interface MotivoRow { tag: string; qtd: number; }
export interface AtendimentoVolume {
  total: number; novos: number; recorrentes: number;
  proativo: number; reativo: number;
  canais: CanalRow[]; heatmap: HeatCell[];
  /** 'plantao' = o mapa está por hora do trabalho fora do expediente; 'abertura' = por hora de abertura. */
  heatmap_eixo: 'abertura' | 'plantao';
  top_motivos: MotivoRow[]; motivos_cobertura: number | null;
}

export function useAtendimentoVolume() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, tipoAtendimento, plantao } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === 'all' ? null : tipoAtendimento === 'group';
  const pPlantao = plantao === 'all' ? null : plantao;
  return useQuery<AtendimentoVolume>({
    queryKey: ["atendimento-volume", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), viewKey, departmentId, agentId, tipoAtendimento, plantao],
    enabled: !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_volume", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_department_id: departmentId ?? null,
        p_agent_id: agentId ?? null,
        p_is_group: pIsGroup,
        p_plantao: pPlantao,
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
        heatmap: ((d.heatmap ?? []) as any[]).map((r) => ({
          dow: Number(r.dow), hora: Number(r.hora), qtd: Number(r.qtd ?? 0),
          detalhes: Array.isArray(r.detalhes)
            ? (r.detalhes as any[]).map((x) => ({
                hora: String(x.hora ?? ""),
                setor: x.setor ?? null,
                fecha: x.fecha ?? null,
              }))
            : null,
        })),
        heatmap_eixo: d.heatmap_eixo === "plantao" ? "plantao" : "abertura",
        top_motivos: ((d.top_motivos ?? []) as any[]).map((r) => ({ tag: String(r.tag), qtd: Number(r.qtd ?? 0) })),
        motivos_cobertura: num(d.motivos_cobertura),
      } as AtendimentoVolume;
    },
  });
}
