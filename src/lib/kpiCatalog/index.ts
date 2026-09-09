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
