import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface AgenteRow {
  agent_id: string;
  nome: string;
  total: number;
  encerrados: number;
  tma_p50: number | null;
  frt_p50: number | null;
  csat: number | null;
  csat_n: number;
  csat_sent_n: number;
  reabertura_pct: number | null;
  pico_simultaneos: number;
  latencia_p50: number | null;
  latencia_faixa: string | null;
  msgs_atend: number | null;
}

/** Célula do quadro Agente × Categoria. category_id null = sem ticket categorizado. */
export interface AgenteCategoriaRow {
  agent_id: string;
  category_id: string | null;
  categoria: string | null;
  total: number;
  tma_p50: number | null;
  csat: number | null;
  csat_n: number;
}

export interface AtendimentoAgentes {
  total_encerrados: number;
  agentes_ativos: number;
  csat_equipe: number | null;
  csat_equipe_n: number;
  csat_equipe_sent_n: number;
  reabertura_equipe_pct: number | null;
  agentes: AgenteRow[];
  por_categoria: AgenteCategoriaRow[];
}

/**
 * `ignorarCategoria`: a mesma consulta sem o filtro de categoria. É a base do
 * "% do agente" quando a tela filtra só "Sem categoria".
 */
export function useAtendimentoAgentes(opts: { ignorarCategoria?: boolean; enabled?: boolean } = {}) {
  const { ignorarCategoria = false, enabled = true } = opts;
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const filtro = useAtendimentoFilter();
  const { dateRange, departmentId, tipoAtendimento, plantao } = filtro;
  const categoryIds = ignorarCategoria ? [] : filtro.categoryIds;
  const subcategoryIds = ignorarCategoria ? [] : filtro.subcategoryIds;
  const pIsGroup = tipoAtendimento === 'all' ? null : tipoAtendimento === 'group';
  const pPlantao = plantao === 'all' ? null : plantao;
  return useQuery<AtendimentoAgentes>({
    queryKey: ["atendimento-agentes", tid, dateRange.from.toISOString(), dateRange.to.toISOString(), viewKey, departmentId, tipoAtendimento, plantao, categoryIds, subcategoryIds],
    enabled: enabled && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_agentes", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_department_id: departmentId ?? null,
        p_is_group: pIsGroup,
        p_plantao: pPlantao,
        p_category_ids: categoryIds.length ? categoryIds : null,
        p_subcategory_ids: subcategoryIds.length ? subcategoryIds : null,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        total_encerrados: Number(d.total_encerrados ?? 0),
        agentes_ativos: Number(d.agentes_ativos ?? 0),
        csat_equipe: num(d.csat_equipe),
        csat_equipe_n: Number(d.csat_equipe_n ?? 0),
        csat_equipe_sent_n: Number(d.csat_equipe_sent_n ?? 0),
        reabertura_equipe_pct: num(d.reabertura_equipe_pct),
        agentes: ((d.agentes ?? []) as any[]).map((r) => ({
          agent_id: String(r.agent_id),
          nome: r.nome ?? "Sem nome",
          total: Number(r.total ?? 0),
          encerrados: Number(r.encerrados ?? 0),
          tma_p50: num(r.tma_p50),
          frt_p50: num(r.frt_p50),
          csat: num(r.csat),
          csat_n: Number(r.csat_n ?? 0),
          csat_sent_n: Number(r.csat_sent_n ?? 0),
          reabertura_pct: num(r.reabertura_pct),
          pico_simultaneos: Number(r.pico_simultaneos ?? 0),
          latencia_p50: num(r.latencia_p50),
          latencia_faixa: r.latencia_faixa ?? null,
          msgs_atend: num(r.msgs_atend),
        })),
        por_categoria: ((d.por_categoria ?? []) as any[]).map((r) => ({
          agent_id: String(r.agent_id),
          category_id: r.category_id ?? null,
          categoria: r.categoria ?? null,
          total: Number(r.total ?? 0),
          tma_p50: num(r.tma_p50),
          csat: num(r.csat),
          csat_n: Number(r.csat_n ?? 0),
        })),
      } as AtendimentoAgentes;
    },
  });
}
