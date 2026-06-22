import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

export interface CsatSetorRow {
  department_id: string | null;
  setor: string;
  media: number | null;
  respostas: number;
}
export interface CsatDistRow {
  score: number;
  qtd: number;
}
export interface CsatResolRow {
  score: number;
  mediana_seg: number | null;
  qtd: number;
}
export interface AtendimentoSatisfacao {
  enviadas: number;
  respostas: number;
  media: number | null;
  response_rate_pct: number | null;
  distribuicao: CsatDistRow[];
  por_setor: CsatSetorRow[];
  div_neg_total: number;
  div_neg_nota_alta: number;
  resolucao_por_nota: CsatResolRow[];
  total_encerrados: number;
  atendeu_na_hora: number;
  atendeu_na_hora_pct: number | null;
}

export function useAtendimentoSatisfacao() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId } = useUnidadeFilter();
  const { dateRange, departmentId, agentId } = useAtendimentoFilter();
  return useQuery<AtendimentoSatisfacao>({
    queryKey: [
      "atendimento-satisfacao",
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      selectedUnidadeId,
      departmentId,
      agentId,
    ],
    enabled: !!tid,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_atendimento_satisfacao", {
        p_tenant_id: tid,
        p_date_from: dateRange.from.toISOString(),
        p_date_to: dateRange.to.toISOString(),
        p_unidade_base_id: selectedUnidadeId ?? null,
        p_department_id: departmentId ?? null,
        p_agent_id: agentId ?? null,
      });
      if (error) throw error;
      const d = (data ?? {}) as any;
      const num = (v: any) => (v === null || v === undefined ? null : Number(v));
      return {
        enviadas: Number(d.enviadas ?? 0),
        respostas: Number(d.respostas ?? 0),
        media: num(d.media),
        response_rate_pct: num(d.response_rate_pct),
        distribuicao: ((d.distribuicao ?? []) as any[]).map((r) => ({
          score: Number(r.score),
          qtd: Number(r.qtd ?? 0),
        })),
        por_setor: ((d.por_setor ?? []) as any[]).map((r) => ({
          department_id: r.department_id ?? null,
          setor: r.setor ?? "Sem setor",
          media: num(r.media),
          respostas: Number(r.respostas ?? 0),
        })),
        div_neg_total: Number(d.div_neg_total ?? 0),
        div_neg_nota_alta: Number(d.div_neg_nota_alta ?? 0),
        resolucao_por_nota: ((d.resolucao_por_nota ?? []) as any[]).map((r) => ({
          score: Number(r.score),
          mediana_seg: num(r.mediana_seg),
          qtd: Number(r.qtd ?? 0),
        })),
        total_encerrados: Number(d.total_encerrados ?? 0),
        atendeu_na_hora: Number(d.atendeu_na_hora ?? 0),
        atendeu_na_hora_pct: num(d.atendeu_na_hora_pct),
      } as AtendimentoSatisfacao;
    },
  });
}
