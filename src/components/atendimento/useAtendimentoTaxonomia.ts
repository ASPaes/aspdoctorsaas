import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";

export interface TaxProdRow { produto_id: number | null; nome: string; qtd: number; pct: number; }
export interface TaxCatRow { category_id: string | null; nome: string; qtd: number; pct: number; }
export interface TaxDensRow { produto_id: number | null; nome: string; tickets: number; clientes: number; ratio: number | null; }
export interface AtendimentoTaxonomia {
  total: number; por_produto: TaxProdRow[]; por_categoria: TaxCatRow[]; densidade: TaxDensRow[];
}

export function useAtendimentoTaxonomia(dateRange: { from: Date; to: Date }) {
  const { effectiveTenantId: tid } = useTenantFilter();
  return useQuery<AtendimentoTaxonomia>({
    queryKey: ["atendimento-taxonomia", tid, dateRange.from.toISOString(), dateRange.to.toISOString()],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_taxonomia", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        total: Number(d.total ?? 0),
        por_produto: ((d.por_produto ?? []) as any[]).map((r) => ({ produto_id: r.produto_id ?? null, nome: r.nome ?? "(sem produto)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        por_categoria: ((d.por_categoria ?? []) as any[]).map((r) => ({ category_id: r.category_id ?? null, nome: r.nome ?? "(sem categoria)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        densidade: ((d.densidade ?? []) as any[]).map((r) => ({ produto_id: r.produto_id ?? null, nome: r.nome ?? "(sem produto)", tickets: Number(r.tickets ?? 0), clientes: Number(r.clientes ?? 0), ratio: num(r.ratio) })),
      } as AtendimentoTaxonomia;
    },
  });
}
