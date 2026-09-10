import { useMemo } from "react";
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

/** O que CADA RPC aceita, conferido em `pg_get_function_identity_arguments`
 *  contra o banco em 09/09/2026.
 *
 *  Isso não é zelo excessivo: mandar um argumento nomeado que a função não
 *  declara faz o PostgREST não achar a função e a chamada falhar inteira.
 *  Um objeto genérico com "todos os filtros" quebrava 5 das 11 — `clientes`
 *  recusa quatro, `ura` e `latencia` recusam dois cada, `agentes` e
 *  `backlog` um cada. */
export const PARAMS_ACEITOS: Record<string, readonly string[]> = {
  "atendimento.volume": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.velocidade": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_sla_frt_seconds", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.velocidade_timeline": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_sla_frt_seconds", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.backlog": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id"],
  "atendimento.agentes": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_is_group", "p_plantao"],
  "atendimento.satisfacao": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_is_group", "p_plantao"],
  "atendimento.ura": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_plantao"],
  "atendimento.taxonomia": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_unidade_base_id", "p_agent_id", "p_plantao"],
  "atendimento.clientes": ["p_tenant_id", "p_date_from", "p_date_to", "p_unidade_base_id"],
  "atendimento.latencia": ["p_tenant_id", "p_date_from", "p_date_to", "p_department_id", "p_agent_id", "p_is_group"],
  "atendimento.tempo_real": ["p_tenant_id", "p_department_id", "p_unidade_base_id", "p_is_group"],
};

export function montarParamsAtendimento(
  provider: ProviderId,
  tid: string,
  f: FiltrosSecao,
  unidadeId: number | null,
) {
  const { from, to } = intervaloDaSecao(f);
  const isGroup = f.tipoAtendimento === "all" ? null : f.tipoAtendimento === "group";
  const plantao = f.plantao === "all" ? null : f.plantao;

  const todos: Record<string, unknown> = {
    p_tenant_id: tid,
    p_date_from: from.toISOString(),
    p_date_to: to.toISOString(),
    p_unidade_base_id: unidadeId,
    p_department_id: f.departmentId,
    p_agent_id: f.agentId,
    p_is_group: isGroup,
    p_plantao: plantao,
    p_sla_frt_seconds: SLA_FRT_PADRAO_SEG,
  };

  const aceitos = PARAMS_ACEITOS[provider] ?? [];
  const params: Record<string, unknown> = {};
  for (const nome of aceitos) params[nome] = todos[nome];
  return params;
}

/** Busca UM provider de Atendimento. `ativo` falso não dispara consulta. */
function useProviderAtendimento(provider: ProviderId, filtros: FiltrosSecao, ativo: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { selectedUnidadeId, viewKey, unidadeFilterReady } = useUnidadeFilter();
  const rpc = RPC_ATENDIMENTO[provider];
  const params = tid ? montarParamsAtendimento(provider, tid, filtros, selectedUnidadeId ?? null) : null;

  return useQuery<unknown>({
    queryKey: ["meu-painel", provider, tid, viewKey, params],
    enabled: ativo && !!rpc && !!tid && unidadeFilterReady,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)(rpc!, params);
      if (error) throw error;
      return data ?? {};
    },
  });
}

/** Os 11 providers de Atendimento, em ordem fixa. Cada seção precisa de um
 *  subconjunto diferente, mas o NÚMERO de hooks tem que ser constante entre
 *  renders — chamar hook dentro de um `map` sobre a lista da seção quebra as
 *  regras do React no instante em que o gestor edita o painel. Os que a
 *  seção não usa ficam com `enabled: false` e não geram consulta nenhuma. */
const PROVIDERS_ATENDIMENTO = Object.keys(RPC_ATENDIMENTO).sort() as ProviderId[];

export function useDadosAtendimento(
  necessarios: ReadonlySet<ProviderId>,
  filtros: FiltrosSecao,
): DadosDaSecao & { carregando: boolean } {
  const p = PROVIDERS_ATENDIMENTO;
  const queries = [
    useProviderAtendimento(p[0], filtros, necessarios.has(p[0])),
    useProviderAtendimento(p[1], filtros, necessarios.has(p[1])),
    useProviderAtendimento(p[2], filtros, necessarios.has(p[2])),
    useProviderAtendimento(p[3], filtros, necessarios.has(p[3])),
    useProviderAtendimento(p[4], filtros, necessarios.has(p[4])),
    useProviderAtendimento(p[5], filtros, necessarios.has(p[5])),
    useProviderAtendimento(p[6], filtros, necessarios.has(p[6])),
    useProviderAtendimento(p[7], filtros, necessarios.has(p[7])),
    useProviderAtendimento(p[8], filtros, necessarios.has(p[8])),
    useProviderAtendimento(p[9], filtros, necessarios.has(p[9])),
    useProviderAtendimento(p[10], filtros, necessarios.has(p[10])),
  ];

  const dados: DadosDaSecao = {};
  p.forEach((id, i) => {
    if (necessarios.has(id)) dados[id] = queries[i].data;
  });

  const carregando = p.some((id, i) => necessarios.has(id) && queries[i].isLoading);
  return { ...dados, carregando };
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

  /** ⚠️ Este useMemo NÃO é otimização, é o que impede um loop infinito.
   *  `useDashboardData` guarda o fetch num useCallback com `[filters]` na
   *  dependência e dispara por useEffect. Objeto novo a cada render =
   *  efeito dispara = setLoading(true) = render = objeto novo. O painel
   *  ficava preso no esqueleto martelando o banco.
   *
   *  As dependências são primitivas de propósito: data em milissegundo e a
   *  lista de fornecedores serializada. */
  const { from, to } = intervaloDaSecao(filtros);
  const deInicio = from.getTime();
  const deFim = to.getTime();
  const chaveFornecedores = filtros.fornecedorIds.join(",");
  const unidade = selectedUnidadeId ?? null;

  const filters = useMemo(
    () => filtrosDashboardDaSecao(filtros, unidade),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deInicio, deFim, chaveFornecedores, unidade],
  );

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
