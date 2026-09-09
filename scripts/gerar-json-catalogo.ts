/** Despeja o catálogo + os órfãos como JSON, para alimentar a página de
 *  revisão. Rodar: bunx tsx scripts/gerar-json-catalogo.ts > /tmp/catalogo.json
 */
import kpiHelp from "../src/lib/kpiHelp";
import { kpiCatalog, verbetesSemEntrada, entradasSemVerbete } from "../src/lib/kpiCatalog";

const itens = kpiCatalog.map((e) => ({
  id: e.id,
  area: e.area,
  kind: e.kind,
  label: e.label,
  def: e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "",
  origem: `${e.source.provider}.${e.source.path}`,
  temAjuda: !!e.helpKey,
  pending: !!e.pending,
}));

const orfaos = verbetesSemEntrada().map((k) => ({
  chave: k,
  titulo: kpiHelp[k]?.title ?? "",
  def: kpiHelp[k]?.definition ?? "",
}));

console.log(JSON.stringify({ itens, orfaos, semAjuda: entradasSemVerbete() }));
