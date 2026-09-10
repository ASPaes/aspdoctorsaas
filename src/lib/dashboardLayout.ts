import { entradaPorId, type CatalogEntry, type KpiArea } from "@/lib/kpiCatalog";

export const MAX_ITENS = 15;
export const MAX_SECOES = 5;

/** Atalho relativo ou intervalo absoluto. Painel diário NUNCA guarda o dia em
 *  que foi montado: 'hoje' congelado vira lixo amanhã de manhã. */
export type PeriodoRelativo = "hoje" | "ontem" | "7d" | "30d" | "mes_atual" | "mes_anterior";
export type PeriodoSalvo = PeriodoRelativo | { de: string; ate: string };

export interface LayoutItem {
  id: string;
  span?: 2 | 3 | 4;
}

export interface LayoutSecao {
  id: string;
  nome: string;
  /** @deprecated A seção não tem mais área fixa — ela é o que o gestor
   *  colocou dentro, e pode misturar áreas. Continua sendo lido dos painéis
   *  salvos antes de 10/09/2026 para não quebrar nenhum layout, mas quem
   *  manda são as áreas dos itens (ver `areasDaSecao`). */
  area?: KpiArea;
  /** Filtros crus. Cada área consome os que aceita. */
  filtros: Record<string, unknown>;
  itens: LayoutItem[];
}

export interface DashboardLayout {
  versao: 1;
  secoes: LayoutSecao[];
}

export const LAYOUT_VAZIO: DashboardLayout = { versao: 1, secoes: [] };

const AREAS: KpiArea[] = ["atendimento", "financeiro", "cs", "implantacao", "certificados"];

export function contarItens(layout: DashboardLayout): number {
  return layout.secoes.reduce((n, s) => n + s.itens.length, 0);
}

export type Validacao = { ok: true } | { ok: false; erro: string };

export function validarLayout(layout: DashboardLayout): Validacao {
  if (layout.secoes.length > MAX_SECOES) {
    return { ok: false, erro: `O painel aceita no máximo ${MAX_SECOES} seções.` };
  }
  const total = contarItens(layout);
  if (total > MAX_ITENS) {
    return {
      ok: false,
      erro: `O painel aceita no máximo ${MAX_ITENS} indicadores. Você selecionou ${total}.`,
    };
  }
  for (const s of layout.secoes) {
    if (!s.nome.trim()) return { ok: false, erro: "Toda seção precisa de um nome." };
    const ids = s.itens.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      return { ok: false, erro: `A seção "${s.nome}" tem o mesmo indicador repetido.` };
    }
  }
  return { ok: true };
}

function secaoValida(raw: unknown): raw is LayoutSecao {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  const areaOk = s.area === undefined || AREAS.includes(s.area as KpiArea);
  return (
    typeof s.id === "string" &&
    typeof s.nome === "string" &&
    areaOk &&
    Array.isArray(s.itens)
  );
}

/** Lê o jsonb do banco sem confiar nele. Seção que não entendemos é descartada
 *  em silêncio: um layout corrompido não pode derrubar a tela do gestor. */
export function parseLayout(raw: unknown): DashboardLayout {
  if (!raw || typeof raw !== "object") return LAYOUT_VAZIO;
  const l = raw as Record<string, unknown>;
  if (l.versao !== 1 || !Array.isArray(l.secoes)) return LAYOUT_VAZIO;
  const secoes = l.secoes.filter(secaoValida).map((s) => ({
    id: s.id,
    nome: s.nome,
    ...(s.area ? { area: s.area } : {}),
    filtros: (s.filtros ?? {}) as Record<string, unknown>,
    itens: (s.itens as unknown[]).filter(
      (i): i is LayoutItem => !!i && typeof (i as LayoutItem).id === "string",
    ),
  }));
  return { versao: 1, secoes };
}

/** Áreas presentes numa seção, deduzidas dos itens. A seção não tem mais
 *  área fixa: ela é o que o gestor colocou dentro. */
export function areasDaSecao(secao: LayoutSecao): KpiArea[] {
  const vistas = new Set<KpiArea>();
  for (const item of secao.itens) {
    const e = entradaPorId(item.id);
    if (e) vistas.add(e.area);
  }
  return AREAS.filter((a) => vistas.has(a));
}

/** Item cujo id sumiu do catálogo não quebra o painel: sai da renderização e
 *  volta na lista de desconhecidos, para avisar uma vez no console. */
export function separarConhecidos(secao: LayoutSecao): {
  conhecidos: CatalogEntry[];
  desconhecidos: string[];
} {
  const conhecidos: CatalogEntry[] = [];
  const desconhecidos: string[] = [];
  for (const item of secao.itens) {
    const entrada = entradaPorId(item.id);
    if (entrada) conhecidos.push(entrada);
    else desconhecidos.push(item.id);
  }
  return { conhecidos, desconhecidos };
}

function inicioDoDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function fimDoDia(d: Date): Date {
  const r = new Date(d);
  r.setHours(23, 59, 59, 999);
  return r;
}

export function resolverPeriodo(
  periodo: PeriodoSalvo,
  agora: Date,
): { from: Date; to: Date } {
  if (typeof periodo !== "string") {
    return { from: new Date(periodo.de), to: new Date(periodo.ate) };
  }
  switch (periodo) {
    case "hoje":
      return { from: inicioDoDia(agora), to: fimDoDia(agora) };
    case "ontem": {
      const d = new Date(agora);
      d.setDate(d.getDate() - 1);
      return { from: inicioDoDia(d), to: fimDoDia(d) };
    }
    case "7d": {
      const d = new Date(agora);
      d.setDate(d.getDate() - 6);
      return { from: inicioDoDia(d), to: fimDoDia(agora) };
    }
    case "30d": {
      const d = new Date(agora);
      d.setDate(d.getDate() - 29);
      return { from: inicioDoDia(d), to: fimDoDia(agora) };
    }
    case "mes_atual": {
      const d = new Date(agora.getFullYear(), agora.getMonth(), 1);
      return { from: inicioDoDia(d), to: fimDoDia(agora) };
    }
    case "mes_anterior": {
      const ini = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
      /** Dia 0 do mês corrente = último dia do mês anterior. Vira o ano
       *  sozinho: mes_anterior em janeiro cai em dezembro do ano passado. */
      const fim = new Date(agora.getFullYear(), agora.getMonth(), 0);
      return { from: inicioDoDia(ini), to: fimDoDia(fim) };
    }
  }
}
