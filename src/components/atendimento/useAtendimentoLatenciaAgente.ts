import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenantFilter } from "@/contexts/TenantFilterContext";
import { useAtendimentoFilter } from "@/contexts/AtendimentoFilterContext";

/**
 * Detalhe da latência de UM agente (DEM-0364).
 *
 * A linha é uma resposta, não um atendimento: a latência do scorecard nasce em
 * `whatsapp_messages`, casando bloco do cliente -> primeira resposta do agente.
 *
 * Por isso o recorte aqui é o mesmo da `get_atendimento_agentes` e só usa
 * `tipoAtendimento`, `plantao` e categoria/subcategoria (DEM-0315) — setor e
 * unidade NÃO filtram a latência lá, e
 * filtrar aqui faria a lista deixar de fechar com o valor da tela.
 */
export interface LatenciaRespostaItem {
  conversation_id: string;
  /** Instante da mensagem do cliente que abriu a espera. */
  cli_first: string;
  /** Instante da primeira resposta do agente. */
  agt_first: string;
  preview: string | null;
  contato: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  departamento: string | null;
  is_group: boolean;
  seg: number;
  /** false = acima do teto da latência, fora da mediana e do p90. */
  no_calculo: boolean;
}

export interface LatenciaFaixa {
  idx: number;
  faixa: string;
  qtd: number;
}

export interface AtendimentoLatenciaAgente {
  agent_id: string;
  nome: string | null;
  /** Teto da latência (`kpi_cap_seconds('latencia')`), em segundos. */
  cap_seconds: number;
  total_lista: number;
  total_no_calculo: number;
  total_fora_cap: number;
  total_conversas: number;
  p50: number | null;
  p90: number | null;
  truncado: boolean;
  faixas: LatenciaFaixa[];
  itens: LatenciaRespostaItem[];
}

export interface LatenciaAgenteParams {
  tenantId: string;
  agentId: string;
  from: string;
  to: string;
  isGroup: boolean | null;
  plantao: string | null;
  categoryIds: string[];
  subcategoryIds: string[];
  limit: number;
}

/** A lista do diálogo carrega 200; a exportação chama de novo com o teto alto. */
export const LATENCIA_LIMITE_TELA = 200;
export const LATENCIA_LIMITE_EXPORT = 5000;

export async function fetchLatenciaAgente(
  p: LatenciaAgenteParams,
): Promise<AtendimentoLatenciaAgente> {
  const { data, error } = await (supabase.rpc as any)("get_atendimento_latencia_agente", {
    p_tenant_id: p.tenantId,
    p_date_from: p.from,
    p_date_to: p.to,
    p_agent_id: p.agentId,
    p_is_group: p.isGroup,
    p_plantao: p.plantao,
    p_limit: p.limit,
    p_category_ids: p.categoryIds.length ? p.categoryIds : null,
    p_subcategory_ids: p.subcategoryIds.length ? p.subcategoryIds : null,
  });
  if (error) throw error;
  const d = (data ?? {}) as any;
  const num = (v: any) => (v === null || v === undefined ? null : Number(v));
  return {
    agent_id: String(d.agent_id ?? p.agentId),
    nome: d.nome ?? null,
    cap_seconds: Number(d.cap_seconds ?? 0),
    total_lista: Number(d.total_lista ?? 0),
    total_no_calculo: Number(d.total_no_calculo ?? 0),
    total_fora_cap: Number(d.total_fora_cap ?? 0),
    total_conversas: Number(d.total_conversas ?? 0),
    p50: num(d.p50),
    p90: num(d.p90),
    truncado: d.truncado === true,
    faixas: ((d.faixas ?? []) as any[]).map((f) => ({
      idx: Number(f.idx ?? 0),
      faixa: f.faixa ?? "",
      qtd: Number(f.qtd ?? 0),
    })),
    itens: ((d.itens ?? []) as any[]).map((i) => ({
      conversation_id: String(i.conversation_id),
      cli_first: i.cli_first,
      agt_first: i.agt_first,
      preview: i.preview ?? null,
      contato: i.contato ?? "Sem nome",
      cliente_id: i.cliente_id ?? null,
      cliente_nome: i.cliente_nome ?? null,
      departamento: i.departamento ?? null,
      is_group: i.is_group === true,
      seg: Number(i.seg ?? 0),
      no_calculo: i.no_calculo !== false,
    })),
  } as AtendimentoLatenciaAgente;
}

export function useAtendimentoLatenciaAgente(agentId: string | null, enabled: boolean) {
  const { effectiveTenantId: tid } = useTenantFilter();
  const { dateRange, tipoAtendimento, plantao, categoryIds, subcategoryIds } = useAtendimentoFilter();
  const pIsGroup = tipoAtendimento === "all" ? null : tipoAtendimento === "group";
  const pPlantao = plantao === "all" ? null : plantao;

  return useQuery<AtendimentoLatenciaAgente>({
    queryKey: [
      "atendimento-latencia-agente",
      agentId,
      tid,
      dateRange.from.toISOString(),
      dateRange.to.toISOString(),
      tipoAtendimento,
      plantao,
      categoryIds,
      subcategoryIds,
    ],
    enabled: enabled && !!agentId && !!tid,
    refetchOnWindowFocus: false,
    queryFn: () =>
      fetchLatenciaAgente({
        tenantId: tid as string,
        agentId: agentId as string,
        from: dateRange.from.toISOString(),
        to: dateRange.to.toISOString(),
        isGroup: pIsGroup,
        categoryIds,
        subcategoryIds,
        plantao: pPlantao,
        limit: LATENCIA_LIMITE_TELA,
      }),
  });
}
