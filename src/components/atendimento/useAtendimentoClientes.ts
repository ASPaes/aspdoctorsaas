import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface ClienteRow {
  cliente_id: string; nome: string; chats: number; tickets: number; interacoes: number;
  mrr: number; dens: number | null; neg: number; csat_n: number; csat_avg: number | null;
  reincidencia: number; risco: number; risco_nivel: "alto" | "medio" | "baixo";
}
export interface CoberturaLimiares { dens_mult: number; neg_pct: number; reinc_min: number; csat_max: number; csat_min_n: number; }
export interface AtendimentoClientes {
  totais: { clientes: number; mrr_coberto: number; interacoes: number; cobertura_pct: number; densidade_media: number | null; risco_alto: number; limiares: CoberturaLimiares };
  clientes: ClienteRow[];
}

export function useAtendimentoClientes() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  const { dateRange, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds } = useAtendimentoFilter();
  return useQuery<AtendimentoClientes>({
    queryKey: ["atendimento-clientes", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), selectedUnidadeId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const orNull = (a: number[]) => (a.length ? a : null);
      const { data, error } = await (supabase.rpc as any)("get_atendimento_clientes", {
        p_tenant_id: tid, p_date_from: dateRange.from.toISOString(), p_date_to: dateRange.to.toISOString(), p_unidade_base_id: selectedUnidadeId ?? null,
        p_segmento_ids: orNull(segmentoIds), p_area_ids: orNull(areaIds), p_estado_ids: orNull(estadoIds),
        p_cidade_ids: orNull(cidadeIds), p_fornecedor_ids: orNull(fornecedorIds), p_produto_ids: orNull(produtoIds),
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const t = (d.totais ?? {}) as any;
      const lim = (t.limiares ?? {}) as any;
      const numN = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        totais: {
          clientes: Number(t.clientes ?? 0),
          mrr_coberto: Number(t.mrr_coberto ?? 0),
          interacoes: Number(t.interacoes ?? 0),
          cobertura_pct: Number(t.cobertura_pct ?? 0),
          densidade_media: numN(t.densidade_media),
          risco_alto: Number(t.risco_alto ?? 0),
          limiares: {
            dens_mult: Number(lim.dens_mult ?? 2), neg_pct: Number(lim.neg_pct ?? 25),
            reinc_min: Number(lim.reinc_min ?? 2), csat_max: Number(lim.csat_max ?? 3), csat_min_n: Number(lim.csat_min_n ?? 2),
          },
        },
        clientes: ((d.clientes ?? []) as any[]).map((r) => ({
          cliente_id: String(r.cliente_id ?? ""), nome: r.nome ?? "(sem nome)",
          chats: Number(r.chats ?? 0), tickets: Number(r.tickets ?? 0), interacoes: Number(r.interacoes ?? 0),
          mrr: Number(r.mrr ?? 0), dens: numN(r.dens), neg: Number(r.neg ?? 0),
          csat_n: Number(r.csat_n ?? 0), csat_avg: numN(r.csat_avg), reincidencia: Number(r.reincidencia ?? 0),
          risco: Number(r.risco ?? 0), risco_nivel: (r.risco_nivel ?? "baixo") as "alto" | "medio" | "baixo",
        })),
      } as AtendimentoClientes;
    },
  });
}
