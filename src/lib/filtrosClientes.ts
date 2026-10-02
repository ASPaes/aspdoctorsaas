// Filtros avançados da carteira de clientes: fonte única.
//
// Usados pela tela de Clientes e pelo Envio em lote (aba Clientes). Mexeu aqui,
// as duas telas mudam juntas: era o pedido ("filtro conforme a tela de
// clientes"), e duas cópias divergiriam na primeira alteração.
import { format } from "date-fns";
import type { DateRange } from "@/components/ui/date-range-picker";
import type { ClientesFilters } from "@/hooks/useClientesFilters";
import { filtroOrBuscaCliente as buildSearchOr } from "@/lib/buscaCliente";

/** O que os filtros leem. `busca` já vem com debounce. */
export type FiltrosClientes = Pick<
  ClientesFilters,
  | "status" | "unidadeBaseQuick" | "somenteMatrizes" | "apenasSetupIncompleto"
  | "periodoCadastro" | "periodoCancelamento" | "periodoVenda" | "periodoAtivacao"
  | "recorrenciaAdv" | "modeloContratoId" | "produtoId" | "moduloIds" | "origemVendaId"
  | "areaAtuacaoId" | "segmentoId" | "funcionarioId" | "fornecedorId"
  | "estadoId" | "cidadeId" | "motivoCancelamentoId"
  | "mensalidadeMin" | "mensalidadeMax" | "lucroMin" | "lucroMax" | "margemMin" | "margemMax"
> & { busca?: string };

export const FILTROS_CLIENTES_VAZIOS: FiltrosClientes = {
  status: "ativos",
  unidadeBaseQuick: "",
  somenteMatrizes: false,
  apenasSetupIncompleto: false,
  periodoCadastro: {},
  periodoCancelamento: {},
  periodoVenda: {},
  periodoAtivacao: {},
  recorrenciaAdv: "",
  modeloContratoId: "",
  produtoId: "",
  moduloIds: [],
  origemVendaId: "",
  areaAtuacaoId: "",
  segmentoId: "",
  funcionarioId: "",
  fornecedorId: "",
  estadoId: "",
  cidadeId: "",
  motivoCancelamentoId: "",
  mensalidadeMin: "",
  mensalidadeMax: "",
  lucroMin: "",
  lucroMax: "",
  margemMin: "",
  margemMax: "",
};

/** "1.234,56", "1234,56" ou "1234.56" → número. Vazio ou lixo → null. */
export function lerNumeroFiltro(value: string): number | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  let normalized = raw;
  if (normalized.includes(",") && normalized.includes(".")) normalized = normalized.replace(/\./g, "").replace(",", ".");
  else if (normalized.includes(",")) normalized = normalized.replace(",", ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function faixasDeValor(f: Pick<FiltrosClientes, "mensalidadeMin" | "mensalidadeMax" | "lucroMin" | "lucroMax" | "margemMin" | "margemMax">) {
  return {
    mensalidadeMin: lerNumeroFiltro(f.mensalidadeMin),
    mensalidadeMax: lerNumeroFiltro(f.mensalidadeMax),
    lucroMin: lerNumeroFiltro(f.lucroMin),
    lucroMax: lerNumeroFiltro(f.lucroMax),
    margemMin: lerNumeroFiltro(f.margemMin),
    margemMax: lerNumeroFiltro(f.margemMax),
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularLucroReal(row: any): number {
  const mensalidade = Number(row.mensalidade ?? 0);
  if (!(mensalidade > 0)) return 0;
  const custo = Number(row.custo_operacao ?? 0);
  const imposto = Number(row.imposto_percentual ?? 0);
  const fixo = Number(row.custo_fixo_percentual ?? 0);
  return round2((mensalidade - custo) - round2(mensalidade * imposto) - round2(mensalidade * fixo));
}

export function calcularMargemBruta(row: any): number {
  const mensalidade = Number(row.mensalidade ?? 0);
  if (!(mensalidade > 0)) return 0;
  const custo = Number(row.custo_operacao ?? 0);
  return round2(((mensalidade - custo) / mensalidade) * 100);
}

/**
 * Filtros que o banco resolve (consulta em `vw_clientes_financeiro`).
 * `forNovosNoMes` troca o filtro de situação pelo mês corrente da venda.
 */
export function aplicarFiltrosClientes(query: any, f: FiltrosClientes, options?: { forNovosNoMes?: boolean }) {
  let q = query;

  if (options?.forNovosNoMes === true) {
    const now = new Date();
    const firstDay = format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd");
    const lastDay = format(new Date(now.getFullYear(), now.getMonth() + 1, 0), "yyyy-MM-dd");
    q = q.gte("data_venda_efetiva", firstDay).lte("data_venda_efetiva", lastDay);
  } else {
    if (f.status === "ativos") q = q.eq("cancelado", false);
    else if (f.status === "cancelados") q = q.eq("cancelado", true);
  }

  if (f.apenasSetupIncompleto) q = q.eq("setup_completo", false);

  if (f.busca) q = q.or(buildSearchOr(f.busca));

  if (f.unidadeBaseQuick === "__null__") q = q.is("unidade_base_id", null);
  else if (f.unidadeBaseQuick) q = q.eq("unidade_base_id", Number(f.unidadeBaseQuick));

  if (f.recorrenciaAdv === "__null__") q = q.is("recorrencia", null);
  else if (f.recorrenciaAdv) q = q.eq("recorrencia", f.recorrenciaAdv as any);

  const applyLookupFilter = (field: string, val: string) => {
    if (val === "__null__") q = q.is(field, null);
    else if (val) q = q.eq(field, Number(val));
  };
  applyLookupFilter("modelo_contrato_id", f.modeloContratoId);
  applyLookupFilter("origem_venda_id", f.origemVendaId);
  applyLookupFilter("estado_id", f.estadoId);
  applyLookupFilter("cidade_id", f.cidadeId);
  applyLookupFilter("motivo_cancelamento_id", f.motivoCancelamentoId);
  applyLookupFilter("area_atuacao_id", f.areaAtuacaoId);
  applyLookupFilter("segmento_id", f.segmentoId);
  applyLookupFilter("funcionario_id", f.funcionarioId);

  const applyDateRange = (field: string, range: DateRange) => {
    if (range.from) q = q.gte(field, format(range.from, "yyyy-MM-dd"));
    if (range.to) q = q.lte(field, format(range.to, "yyyy-MM-dd"));
  };
  applyDateRange("data_cadastro", f.periodoCadastro);
  applyDateRange("data_cancelamento", f.periodoCancelamento);
  applyDateRange("data_venda_efetiva", f.periodoVenda);
  applyDateRange("data_ativacao", f.periodoAtivacao);

  const v = faixasDeValor(f);
  if (v.mensalidadeMin !== null) q = q.gte("mensalidade", v.mensalidadeMin);
  if (v.mensalidadeMax !== null) q = q.lte("mensalidade", v.mensalidadeMax);

  return q;
}

/** Filtros resolvidos depois da consulta: matriz, produto/módulo, lucro e margem. */
export function passaFiltrosCalculados(
  row: any,
  f: FiltrosClientes,
  ctx: { idsPorProduto?: Set<string> | null; idsMatriz?: Set<string> | null },
): boolean {
  if (temFiltroDeProduto(f) && ctx.idsPorProduto && !ctx.idsPorProduto.has(row.id)) return false;
  if (f.somenteMatrizes && ctx.idsMatriz && !ctx.idsMatriz.has(row.id)) return false;
  const v = faixasDeValor(f);
  const lucro = calcularLucroReal(row);
  const margem = calcularMargemBruta(row);
  if (v.lucroMin !== null && lucro < v.lucroMin) return false;
  if (v.lucroMax !== null && lucro > v.lucroMax) return false;
  if (v.margemMin !== null && margem < v.margemMin) return false;
  if (v.margemMax !== null && margem > v.margemMax) return false;
  return true;
}

export function temFiltroDeProduto(f: Pick<FiltrosClientes, "fornecedorId" | "produtoId" | "moduloIds">): boolean {
  return !!(f.fornecedorId || f.produtoId || f.moduloIds.length > 0);
}

/** Quantos filtros avançados estão ligados (situação e busca não contam). */
export function contarFiltrosAvancados(f: FiltrosClientes): number {
  const datas = [f.periodoCadastro, f.periodoCancelamento, f.periodoVenda, f.periodoAtivacao]
    .filter((d) => d.from || d.to).length;
  const textos = [
    f.recorrenciaAdv, f.modeloContratoId, f.produtoId, f.origemVendaId, f.areaAtuacaoId, f.segmentoId,
    f.funcionarioId, f.fornecedorId, f.estadoId, f.cidadeId, f.motivoCancelamentoId,
  ].filter(Boolean).length;
  const faixas = [f.mensalidadeMin || f.mensalidadeMax, f.lucroMin || f.lucroMax, f.margemMin || f.margemMax]
    .filter(Boolean).length;
  return datas + textos + faixas + (f.moduloIds.length ? 1 : 0) + (f.somenteMatrizes ? 1 : 0) + (f.apenasSetupIncompleto ? 1 : 0);
}
