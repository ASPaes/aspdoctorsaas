import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface TaxProdRow { produto_id: number | null; nome: string; qtd: number; pct: number; }
export interface TaxCatRow { category_id: string | null; nome: string; qtd: number; pct: number; }
export interface TaxDensRow { produto_id: number | null; nome: string; tickets: number; clientes: number; ratio: number | null; }
export interface AtendimentoTaxonomia {
  total: number; por_produto: TaxProdRow[]; por_categoria: TaxCatRow[]; densidade: TaxDensRow[];
}

export function useAtendimentoTaxonomia() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds } = useAtendimentoFilter();
...
    queryKey: ["atendimento-taxonomia", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), selectedUnidadeId, departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds],
...
      const orNull = (a: number[]) => (a.length ? a : null);
      const { data, error } = await (supabase.rpc as any)("get_atendimento_taxonomia", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_department_id: departmentId ?? null,
        p_agent_id: agentId ?? null,
        p_segmento_ids: orNull(segmentoIds), p_area_ids: orNull(areaIds), p_estado_ids: orNull(estadoIds),
        p_cidade_ids: orNull(cidadeIds), p_fornecedor_ids: orNull(fornecedorIds), p_produto_ids: orNull(produtoIds),
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
