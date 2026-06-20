import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";

export interface AtendimentoUra {
  total: number;
  enviadas: number;
  com_ura_pct: number | null;
  completadas: number;
  timeout: number;
  pendentes: number;
  confusas: number;
  completadas_pct: number | null;
  timeout_pct: number | null;
  pendentes_pct: number | null;
  confusas_pct: number | null;
}

export function useAtendimentoUra(dateRange: { from: Date; to: Date }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  return useQuery<AtendimentoUra>({
    queryKey: ["atendimento-ura", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), selectedUnidadeId],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_ura", {
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
        enviadas: Number(d.enviadas ?? 0),
        com_ura_pct: num(d.com_ura_pct),
        completadas: Number(d.completadas ?? 0),
        timeout: Number(d.timeout ?? 0),
        pendentes: Number(d.pendentes ?? 0),
        confusas: Number(d.confusas ?? 0),
        completadas_pct: num(d.completadas_pct),
        timeout_pct: num(d.timeout_pct),
        pendentes_pct: num(d.pendentes_pct),
        confusas_pct: num(d.confusas_pct),
      } as AtendimentoUra;
    },
  });
}
