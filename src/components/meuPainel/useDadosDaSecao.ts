import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useUnidadeFilter } from "@/contexts/UnidadeFilterContext";
import { useDashboardData } from "@/components/dashboard/hooks/useDashboardData";
import { useVisaoGeralExtras } from "@/components/dashboard/hooks/useVisaoGeralExtras";
import { useCrescimentoExtras } from "@/components/dashboard/hooks/useCrescimentoExtras";
import { useCancelamentosExtras } from "@/components/dashboard/hooks/useCancelamentosExtras";
import { useUnitEconomicsSeries } from "@/components/dashboard/hooks/useUnitEconomicsSeries";
import { useMargemContribuicaoDashboard } from "@/components/dashboard/hooks/useMargemContribuicaoDashboard";
import { useCSDashboardData } from "@/components/cs/hooks/useCSDashboardData";
import { useCertA1Data } from "@/components/dashboard/hooks/useCertA1Data";
import type { DashboardFilters } from "@/components/dashboard/types";
import type { ProviderId } from "@/lib/kpiCatalog";
import { intervaloDaSecao, type FiltrosSecao } from "./filtrosDaSecao";

/** Mapa provider → dados prontos. O que não veio ainda fica ausente. */
export type DadosDaSecao = Partial<Record<ProviderId, unknown>>;

/** RPC de Atendimento por provider. Nomes e parâmetros são os MESMOS das
 *  abas de origem, conferidos um a um no levantamento.
 *
 *  Por que aqui a gente chama a RPC em vez de reaproveitar o hook, como faz
 *  nas outras áreas: os hooks de Atendimento leem `AtendimentoFilterContext`,
 *  montado uma vez por página e sem valor inicial. Dar filtro próprio a cada
 *  seção exigiria alterar aquele contexto — proibido pela §5.0 da spec.
 *
 *  Isso NÃO abre risco de divergência: em Atendimento quem calcula é o banco.
 *  Mesma função, mesmos argumentos, mesmo resultado. Onde a conta é feita em
 *  TypeScript — Financeiro, CS, Certificados — a gente reaproveita o hook
 *  original em vez de reescrever. */
const RPC_ATENDIMENTO: Partial<Record<ProviderId, string>> = {
  "atendimento.volume": "get_atendimento_volume",
  "atendimento.velocidade": "get_atendimento_velocidade",
  "atendimento.backlog": "get_atendimento_backlog",
  "atendimento.agentes": "get_atendimento_agentes",
  "atendimento.satisfacao": "get_atendimento_satisfacao",
  "atendimento.ura": "get_atendimento_ura",
  "atendimento.taxonomia": "get_atendimento_taxonomia",
  "atendimento.clientes": "get_atendimento_clientes",
  "atendimento.tempo_real": "get_atendimento_realtime",
  "atendimento.latencia": "get_atendimento_latencia_histograma",
  "atendimento.velocidade_timeline": "get_atendimento_velocidade_timeline",
};

export function ehProviderAtendimento(p: ProviderId): boolean {
  return p in RPC_ATENDIMENTO;
}

/** SLA de 1ª resposta padrão, espelhando a aba Velocidade. */
const SLA_FRT_PADRAO_SEG = 300;

function paramsAtendimento(
  provider: ProviderId,
  tid: string,
  f: FiltrosSecao,
  unidadeId: number | null,
) {
  const { from, to } = intervaloDaSecao(f);
  const isGroup = f.tipoAtendimento === "all" ? null : f.tipoAtendimento === "group";
  const plantao = f.plantao === "all" ? null : f.plantao;

  const base: Record<string, unknown> = {
    p_tenant_id: tid,
    p_date_from: from.toISOString(),
    p_date_to: to.toISOString(),
    p_unidade_base_id: unidadeId,
    p_department_id: f.departmentId,
    p_agent_id: f.agentId,
    p_is_group: isGroup,
    p_plantao: plantao,
  };

  /** Tempo real é foto do agora: não recebe intervalo nem agente. */
  if (provider === "atendimento.tempo_real") {
    return { p_tenant_id: tid, p_unidade_base_id: unidadeId, p_is_group: isGroup };
  }
  if (provider === "atendimento.velocidade" || provider === "atendimento.velocidade_timeline") {
    return { ...base, p_sla_frt_seconds: SLA_FRT_PADRAO_SEG };
  }
  return base;
}

/** Busca UM provider de Atendimento. A seção chama este hook uma vez por
 *  provider; a lista vem do layout salvo e é estável entre renders, então a
 *  ordem dos hooks nunca muda. */
export function useProviderAtendimento(provider: ProviderId, filtros: FiltrosSecao) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const rpc = RPC_ATENDIMENTO[provider];
  const params = tid ? paramsAtendimento(provider, tid, filtros, selectedUnidadeId ?? null) : null;

  return useQuery<unknown>({
    queryKey: ["meu-painel", provider, tid, viewKey, params],
    enabled: !!rpc && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(rpc!, params);
      if (error) throw error;
      return data ?? {};
    },
  });
}

/** Monta o `DashboardFilters` que os hooks do Financeiro esperam, a partir
 *  dos filtros da seção. O formato é o da própria tela — conferido em
 *  `src/components/dashboard/types.ts`. */
export function filtrosDashboardDaSecao(
  f: FiltrosSecao,
  unidadeBaseId: number | null,
): DashboardFilters {
  const { from, to } = intervaloDaSecao(f);
  return {
    fornecedorId: f.fornecedorIds.length === 1 ? f.fornecedorIds[0] : null,
    fornecedorIds: f.fornecedorIds,
    periodoInicio: from,
    periodoFim: to,
    showAllData: false,
    unidadeBaseId,
  };
}

/** Toda a cadeia do Financeiro, na MESMA ordem em que as abas de origem
 *  montam: o `metrics` do useDashboardData alimenta os extras. É isso que
 *  garante que o número do painel não pode divergir do número do dashboard.
 *
 *  Este hook só é chamado por um componente que é montado quando a seção
 *  entra na tela — é assim que a carga preguiçosa acontece, sem precisar de
 *  gate dentro dos hooks originais. */
export function useDadosFinanceiro(filtros: FiltrosSecao): DadosDaSecao & { carregando: boolean } {
  const { selectedUnidadeId } = useUnidadeFilter();
  const filters = filtrosDashboardDaSecao(filtros, selectedUnidadeId ?? null);

  const { loading, metrics } = useDashboardData(filters);
  const visaoGeral = useVisaoGeralExtras(filters);
  const unitEconomics = useUnitEconomicsSeries(filters);
  const mc = useMargemContribuicaoDashboard(filters);
  const crescimento = useCrescimentoExtras({
    filters,
    metrics,
    unitEconomics: unitEconomics.data,
    mcData: mc.data,
  });
  const cancelamentos = useCancelamentosExtras({ filters, metrics });

  return {
    "financeiro.dashboard": metrics,
    "financeiro.visao_geral": visaoGeral.data,
    "financeiro.crescimento": crescimento.data,
    "financeiro.cancelamentos": cancelamentos.data,
    carregando: loading,
  };
}

export function useDadosCS(filtros: FiltrosSecao): DadosDaSecao & { carregando: boolean } {
  const { from, to } = intervaloDaSecao(filtros);
  const q = useCSDashboardData({ periodoInicio: from, periodoFim: to });
  return { "cs.dashboard": q.data, carregando: q.isLoading };
}

export function useDadosCertificados(filtros: FiltrosSecao): DadosDaSecao & { carregando: boolean } {
  const { from, to } = intervaloDaSecao(filtros);
  const q = useCertA1Data(from, to);
  return { "certificados.a1": q.data, carregando: q.isLoading };
}
