import type { CatalogEntry, KpiArea } from "./types";
import { atendimento } from "./atendimento";

export * from "./types";

/** O catálogo inteiro, na ordem em que as áreas aparecem no menu. */
export const kpiCatalog: CatalogEntry[] = [...atendimento];

export function entradasDaArea(area: KpiArea): CatalogEntry[] {
  return kpiCatalog.filter((e) => e.area === area);
}

const porId = new Map(kpiCatalog.map((e) => [e.id, e]));

export function entradaPorId(id: string): CatalogEntry | undefined {
  return porId.get(id);
}
