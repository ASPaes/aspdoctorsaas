import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface ClienteRow {
  cliente_id: string; nome: string; chats: number; tickets: number; interacoes: number;
  mrr: number; dens: number | null; neg: number; csat_n: number; csat_avg: number | null; reincidencia: number;
}
export interface AtendimentoClientes {
  totais: { clientes: number; mrr_coberto: number; interacoes: number; cobertura_pct: number; densidade_media: number | null };
  clientes: ClienteRow[];
}

export function useAtendimentoClientes(dateRange: { from: Date; to: Date }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<AtendimentoClientes>({
    queryKey: ["atendimento-clientes", tid, dateRange.from.toISOString(), dateRange.to.toISOString()],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_clientes", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const t = (d.totais ?? {}) as any;
      const numN = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        totais: {
          clientes: Number(t.clientes ?? 0),
          mrr_coberto: Number(t.mrr_coberto ?? 0),
          interacoes: Number(t.interacoes ?? 0),
          cobertura_pct: Number(t.cobertura_pct ?? 0),
          densidade_media: numN(t.densidade_media),
        },
        clientes: ((d.clientes ?? []) as any[]).map((r) => ({
          cliente_id: String(r.cliente_id ?? ""),
          nome: r.nome ?? "(sem nome)",
          chats: Number(r.chats ?? 0),
          tickets: Number(r.tickets ?? 0),
          interacoes: Number(r.interacoes ?? 0),
          mrr: Number(r.mrr ?? 0),
          dens: numN(r.dens),
          neg: Number(r.neg ?? 0),
          csat_n: Number(r.csat_n ?? 0),
          csat_avg: numN(r.csat_avg),
          reincidencia: Number(r.reincidencia ?? 0),
        })),
      } as AtendimentoClientes;
    },
  });
}
