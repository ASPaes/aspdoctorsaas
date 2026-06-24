import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface TaxProdRow { produto_id: number | null; nome: string; qtd: number; pct: number; }
export interface TaxCatRow { category_id: string | null; nome: string; qtd: number; pct: number; }
export interface TaxSubcatRow { subcategory_id: string | null; nome: string; qtd: number; pct: number; }
export interface TaxTipoRow { service_type_id: string | null; nome: string; qtd: number; pct: number; }
export interface TaxStatusRow { slug: string; nome: string; color: string | null; qtd: number; pct: number; }
export interface TaxCanalRow { canal: string; qtd: number; pct: number; }
export interface TaxHorarioRow { tipo: string; qtd: number; pct: number; }
export interface TaxAtendenteRow { nome: string; qtd: number; }
export interface TaxHeatRow { dow: number; hora: number; qtd: number; }
export interface TaxOfensorRow { cliente_id: string | null; nome: string; qtd: number; }
export interface TaxCustoRow { cliente_id: string | null; nome: string; tickets: number; mrr: number; tickets_por_mil: number; }
export interface TaxConcentracao { clientes_com_ticket: number; tickets_com_cliente: number; top1_qtd: number; top1_pct: number; top10_pct: number; }
export interface TaxMediaCliente { clientes_ativos: number; total_tickets: number; media: number | null; }
export interface TaxDensRow { produto_id: number | null; nome: string; tickets: number; clientes: number; ratio: number | null; }
export interface AtendimentoTaxonomia {
  total: number;
  por_produto: TaxProdRow[];
  por_categoria: TaxCatRow[];
  por_subcategoria: TaxSubcatRow[];
  por_tipo_servico: TaxTipoRow[];
  por_status: TaxStatusRow[];
  por_canal: TaxCanalRow[];
  por_horario: TaxHorarioRow[];
  resolvidos_por_atendente: TaxAtendenteRow[];
  heatmap: TaxHeatRow[];
  ofensores: TaxOfensorRow[];
  custo_receita: TaxCustoRow[];
  concentracao: TaxConcentracao;
  media_tickets_cliente: TaxMediaCliente;
  densidade: TaxDensRow[];
}

export function useAtendimentoTaxonomia() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const { dateRange, departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds } = useAtendimentoFilter();
  return useQuery<AtendimentoTaxonomia>({
    queryKey: ["atendimento-taxonomia", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), viewKey, departmentId, agentId, segmentoIds, areaIds, estadoIds, cidadeIds, fornecedorIds, produtoIds],
    enabled: !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
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
        por_subcategoria: ((d.por_subcategoria ?? []) as any[]).map((r) => ({ subcategory_id: r.subcategory_id ?? null, nome: r.nome ?? "(sem subcategoria)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        por_tipo_servico: ((d.por_tipo_servico ?? []) as any[]).map((r) => ({ service_type_id: r.service_type_id ?? null, nome: r.nome ?? "(sem tipo)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        por_status: ((d.por_status ?? []) as any[]).map((r) => ({ slug: r.slug ?? "", nome: r.nome ?? "(sem status)", color: r.color ?? null, qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        por_canal: ((d.por_canal ?? []) as any[]).map((r) => ({ canal: r.canal ?? "(sem canal)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        por_horario: ((d.por_horario ?? []) as any[]).map((r) => ({ tipo: r.tipo ?? "(sem tipo)", qtd: Number(r.qtd ?? 0), pct: Number(r.pct ?? 0) })),
        resolvidos_por_atendente: ((d.resolvidos_por_atendente ?? []) as any[]).map((r) => ({ nome: r.nome ?? "(desconhecido)", qtd: Number(r.qtd ?? 0) })),
        heatmap: ((d.heatmap ?? []) as any[]).map((r) => ({ dow: Number(r.dow ?? 0), hora: Number(r.hora ?? 0), qtd: Number(r.qtd ?? 0) })),
        ofensores: ((d.ofensores ?? []) as any[]).map((r) => ({ cliente_id: r.cliente_id ?? null, nome: r.nome ?? "(sem nome)", qtd: Number(r.qtd ?? 0) })),
        custo_receita: ((d.custo_receita ?? []) as any[]).map((r) => ({ cliente_id: r.cliente_id ?? null, nome: r.nome ?? "(sem nome)", tickets: Number(r.tickets ?? 0), mrr: Number(r.mrr ?? 0), tickets_por_mil: Number(r.tickets_por_mil ?? 0) })),
        concentracao: {
          clientes_com_ticket: Number(d.concentracao?.clientes_com_ticket ?? 0),
          tickets_com_cliente: Number(d.concentracao?.tickets_com_cliente ?? 0),
          top1_qtd: Number(d.concentracao?.top1_qtd ?? 0),
          top1_pct: Number(d.concentracao?.top1_pct ?? 0),
          top10_pct: Number(d.concentracao?.top10_pct ?? 0),
        },
        media_tickets_cliente: {
          clientes_ativos: Number(d.media_tickets_cliente?.clientes_ativos ?? 0),
          total_tickets: Number(d.media_tickets_cliente?.total_tickets ?? 0),
          media: num(d.media_tickets_cliente?.media),
        },
        densidade: ((d.densidade ?? []) as any[]).map((r) => ({ produto_id: r.produto_id ?? null, nome: r.nome ?? "(sem produto)", tickets: Number(r.tickets ?? 0), clientes: Number(r.clientes ?? 0), ratio: num(r.ratio) })),
      } as AtendimentoTaxonomia;
    },
  });
}
