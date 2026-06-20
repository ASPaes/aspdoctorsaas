import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface BacklogPrioRow { prioridade: string; qtd: number; vencidos: number; }
export interface BacklogStatusRow { status: string; color: string | null; qtd: number; }
export interface BacklogProdRow { produto: string; qtd: number; }
export interface AtendimentoBacklog {
  abertos: number; orfaos: number; parados: number; vencidos: number;
  por_prioridade: BacklogPrioRow[];
  aging: { d0_2: number; d3_7: number; d8_30: number; d30p: number };
  por_status: BacklogStatusRow[];
  plantao_total: number; comercial_total: number;
  plantao_por_produto: BacklogProdRow[];
}

export function useAtendimentoBacklog(dateRange: { from: Date; to: Date }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<AtendimentoBacklog>({
    queryKey: ["atendimento-backlog", tid, dateRange.from.toISOString(), dateRange.to.toISOString()],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_backlog", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const ag = (d.aging ?? {}) as any;
      return {
        abertos: Number(d.abertos ?? 0),
        orfaos: Number(d.orfaos ?? 0),
        parados: Number(d.parados ?? 0),
        vencidos: Number(d.vencidos ?? 0),
        por_prioridade: ((d.por_prioridade ?? []) as any[]).map((r) => ({ prioridade: r.prioridade ?? "—", qtd: Number(r.qtd ?? 0), vencidos: Number(r.vencidos ?? 0) })),
        aging: { d0_2: Number(ag.d0_2 ?? 0), d3_7: Number(ag.d3_7 ?? 0), d8_30: Number(ag.d8_30 ?? 0), d30p: Number(ag.d30p ?? 0) },
        por_status: ((d.por_status ?? []) as any[]).map((r) => ({ status: r.status ?? "(sem status)", color: r.color ?? null, qtd: Number(r.qtd ?? 0) })),
        plantao_total: Number(d.plantao_total ?? 0),
        comercial_total: Number(d.comercial_total ?? 0),
        plantao_por_produto: ((d.plantao_por_produto ?? []) as any[]).map((r) => ({ produto: r.produto ?? "(sem produto)", qtd: Number(r.qtd ?? 0) })),
      } as AtendimentoBacklog;
    },
  });
}
