import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface VelocidadeDeptRow {
  department_id: string | null;
  nome: string | null;
  total: number;
  dentro: number;
  pct: number | null;
}
export interface AtendimentoVelocidade {
  total_encerrados: number;
  tme_p50: number | null; tme_p90: number | null;
  frt_p50: number | null; frt_p90: number | null;
  tma_p50: number | null; tma_p90: number | null;
  tmr_p50: number | null; tmr_p90: number | null;
  sla_frt_seconds: number;
  sla_total: number;
  sla_dentro: number;
  sla_pct: number | null;
  sla_util_total: number;
  sla_util_dentro: number;
  sla_util_pct: number | null;
  fora_horario: number;
  nao_atendido: number;
  nao_atendido_pct: number | null;
  por_departamento: VelocidadeDeptRow[];
}

export function useAtendimentoVelocidade(
  dateRange: { from: Date; to: Date },
  slaSeconds: number,
) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  return useQuery<AtendimentoVelocidade>({
    queryKey: [
      "atendimento-velocidade",
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      slaSeconds,
      selectedUnidadeId,
    ],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_velocidade", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_sla_frt_seconds: slaSeconds,
        p_unidade_base_id: selectedUnidadeId ?? null,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        total_encerrados: Number(d.total_encerrados ?? 0),
        tme_p50: num(d.tme_p50), tme_p90: num(d.tme_p90),
        frt_p50: num(d.frt_p50), frt_p90: num(d.frt_p90),
        tma_p50: num(d.tma_p50), tma_p90: num(d.tma_p90),
        tmr_p50: num(d.tmr_p50), tmr_p90: num(d.tmr_p90),
        sla_frt_seconds: Number(d.sla_frt_seconds ?? slaSeconds),
        sla_total: Number(d.sla_total ?? 0),
        sla_dentro: Number(d.sla_dentro ?? 0),
        sla_pct: num(d.sla_pct),
        sla_util_total: Number(d.sla_util_total ?? 0),
        sla_util_dentro: Number(d.sla_util_dentro ?? 0),
        sla_util_pct: num(d.sla_util_pct),
        fora_horario: Number(d.fora_horario ?? 0),
        nao_atendido: Number(d.nao_atendido ?? 0),
        nao_atendido_pct: num(d.nao_atendido_pct),
        por_departamento: ((d.por_departamento ?? []) as any[]).map((r) => ({
          department_id: r.department_id ?? null,
          nome: r.nome ?? null,
          total: Number(r.total ?? 0),
          dentro: Number(r.dentro ?? 0),
          pct: num(r.pct),
        })),
      } as AtendimentoVelocidade;
    },
  });
}
