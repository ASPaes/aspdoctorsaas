import kpiHelp from "@/lib/kpiHelp";
import type { CatalogEntry, KpiArea } from "./types";
import { atendimento } from "./atendimento";
import { financeiro } from "./financeiro";
import { cs } from "./cs";
import { implantacao } from "./implantacao";
import { certificados } from "./certificados";

export * from "./types";

/** O catálogo inteiro, na ordem em que as áreas aparecem no menu. */
export const kpiCatalog: CatalogEntry[] = [
  ...atendimento,
  ...financeiro,
  ...cs,
  ...implantacao,
  ...certificados,
];

export function entradasDaArea(area: KpiArea): CatalogEntry[] {
  return kpiCatalog.filter((e) => e.area === area);
}

const porId = new Map(kpiCatalog.map((e) => [e.id, e]));

export function entradaPorId(id: string): CatalogEntry | undefined {
  return porId.get(id);
}

/** Chaves do kpiHelp que nenhuma entrada do catálogo usa: verbete escrito
 *  para um indicador que não está em nenhuma tela, ou cujo card usa outro
 *  nome. É decisão do owner: escrever o card, ou apagar o verbete. */
export function verbetesSemEntrada(): string[] {
  const usadas = new Set(kpiCatalog.map((e) => e.helpKey).filter(Boolean) as string[]);
  return Object.keys(kpiHelp).filter((k) => !usadas.has(k)).sort();
}

/** Entradas do catálogo sem texto de ajuda. Aparecem no painel sem o "?". */
export function entradasSemVerbete(): string[] {
  return kpiCatalog.filter((e) => !e.helpKey).map((e) => e.id).sort();
}
