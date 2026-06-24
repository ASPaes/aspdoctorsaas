import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";

export interface AtendimentoRealtime {
  fila: number;
  fila_fora_hora: number;
  em_atendimento: number;
  agentes_online: number;
  agentes_pausa: number;
  espera_mais_antigo_seg: number;
  parados_24h: number;
  sla_estourando: number;
  ativos_por_depto: { department_id: string | null; nome: string | null; qtd: number }[];
  atendendo_por_agente: { agent_id: string; nome: string | null; qtd: number }[];
}

export function useAtendimentoRealtime() {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();

  const query = useQuery<AtendimentoRealtime>({
    queryKey: ["atendimento-realtime", tid, viewKey],
    enabled: !!tid && unidadeFilterReady,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(
        "get_atendimento_realtime",
        { p_tenant_id: tid, p_unidade_base_id: selectedUnidadeId ?? null }
      );
      if (error) throw error;
      const raw = (data ?? {}) as any;
      return {
        fila: Number(raw.fila ?? 0),
        fila_fora_hora: Number(raw.fila_fora_hora ?? 0),
        em_atendimento: Number(raw.em_atendimento ?? 0),
        agentes_online: Number(raw.agentes_online ?? 0),
        agentes_pausa: Number(raw.agentes_pausa ?? 0),
        espera_mais_antigo_seg: Number(raw.espera_mais_antigo_seg ?? 0),
        parados_24h: Number(raw.parados_24h ?? 0),
        sla_estourando: Number(raw.sla_estourando ?? 0),
        ativos_por_depto: ((raw.ativos_por_depto ?? []) as any[]).map((r) => ({
          department_id: r.department_id ?? null,
          nome: r.nome ?? null,
          qtd: Number(r.qtd ?? 0),
        })),
        atendendo_por_agente: ((raw.atendendo_por_agente ?? []) as any[]).map((r) => ({
          agent_id: String(r.agent_id),
          nome: r.nome ?? null,
          qtd: Number(r.qtd ?? 0),
        })),
      };
    },
  });

  return { ...query, dataUpdatedAt: query.dataUpdatedAt };
}
