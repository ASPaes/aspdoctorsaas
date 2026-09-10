import type { KpiArea } from "@/lib/kpiCatalog";
import { resolverPeriodo, type PeriodoSalvo } from "@/lib/dashboardLayout";

/** Definição dos filtros que cada área oferece. É daqui que o construtor
 *  desenha os controles e que o provider lê os valores.
 *
 *  Confirmados no levantamento (F1), lendo os hooks de cada área — não
 *  supostos. Atendimento tem 11; a spec previa 6. */
export type TipoFiltro = "periodo" | "setor" | "agente" | "tipoAtendimento" | "plantao" | "fornecedor" | "unidade";

export const FILTROS_DA_AREA: Record<KpiArea, TipoFiltro[]> = {
  atendimento: ["periodo", "setor", "agente", "tipoAtendimento", "plantao"],
  financeiro: ["periodo", "fornecedor"],
  cs: ["periodo"],
  implantacao: ["periodo", "unidade"],
  certificados: ["periodo"],
};

export interface FiltrosSecao {
  periodo: PeriodoSalvo;
  departmentId: string | null;
  agentId: string | null;
  tipoAtendimento: "all" | "individual" | "group";
  plantao: "all" | "plantao" | "comercial";
  fornecedorIds: number[];
  unidadeId: number | null;
}

export const FILTROS_PADRAO: FiltrosSecao = {
  /** "Mês atual" e não "hoje", decidido pelo Alexandre em 10/09/2026: com
   *  "hoje" todo indicador de FLUXO — novos clientes, cancelamentos, New MRR,
   *  volume de atendimento — abre zerado de manhã, e um painel que abre
   *  zerado parece quebrado. Os de FOTO (MRR, ARR, clientes ativos) mostram o
   *  mesmo nos dois. */
  periodo: "mes_atual",
  departmentId: null,
  agentId: null,
  tipoAtendimento: "all",
  plantao: "all",
  fornecedorIds: [],
  unidadeId: null,
};

/** Lê o `filtros` cru do jsonb sem confiar nele, do mesmo jeito que o
 *  parseLayout faz com a seção: campo que não entendemos vira o padrão. */
export function normalizarFiltros(raw: Record<string, unknown> | undefined): FiltrosSecao {
  const r = raw ?? {};
  const periodo = r.periodo;
  const periodoOk =
    typeof periodo === "string" ||
    (!!periodo && typeof periodo === "object" &&
      typeof (periodo as { de?: unknown }).de === "string" &&
      typeof (periodo as { ate?: unknown }).ate === "string");

  const umDe = <T extends string>(v: unknown, opcoes: readonly T[], padrao: T): T =>
    opcoes.includes(v as T) ? (v as T) : padrao;

  return {
    periodo: periodoOk ? (periodo as PeriodoSalvo) : FILTROS_PADRAO.periodo,
    departmentId: typeof r.departmentId === "string" ? r.departmentId : null,
    agentId: typeof r.agentId === "string" ? r.agentId : null,
    tipoAtendimento: umDe(r.tipoAtendimento, ["all", "individual", "group"] as const, "all"),
    plantao: umDe(r.plantao, ["all", "plantao", "comercial"] as const, "all"),
    fornecedorIds: Array.isArray(r.fornecedorIds)
      ? r.fornecedorIds.filter((n): n is number => typeof n === "number")
      : [],
    unidadeId: typeof r.unidadeId === "number" ? r.unidadeId : null,
  };
}

/** O intervalo de datas resolvido AGORA. Chamado a cada render do provider,
 *  de propósito: é isso que faz "hoje" significar hoje. */
export function intervaloDaSecao(f: FiltrosSecao, agora = new Date()) {
  return resolverPeriodo(f.periodo, agora);
}

export const ROTULO_PERIODO: Record<string, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes_atual: "Mês atual",
  mes_anterior: "Mês anterior",
};

export function rotuloDoPeriodo(p: PeriodoSalvo): string {
  if (typeof p !== "string") {
    const d = (s: string) => new Date(s).toLocaleDateString("pt-BR");
    return `${d(p.de)} → ${d(p.ate)}`;
  }
  return ROTULO_PERIODO[p] ?? p;
}
