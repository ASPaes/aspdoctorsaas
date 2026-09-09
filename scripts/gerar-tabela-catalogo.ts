/** Gera a tabela de aprovação do catálogo, para o owner conferir item a item.
 *  Rodar: bunx tsx scripts/gerar-tabela-catalogo.ts > docs/superpowers/specs/2026-09-09-meu-painel-catalogo.md
 */
import kpiHelp from "../src/lib/kpiHelp";
import {
  kpiCatalog, entradasDaArea, verbetesSemEntrada, entradasSemVerbete,
  type KpiArea,
} from "../src/lib/kpiCatalog";

const NOME_AREA: Record<KpiArea, string> = {
  atendimento: "Atendimento",
  financeiro: "Financeiro / MRR",
  cs: "Customer Success",
  implantacao: "Implantação",
  certificados: "Certificados A1",
};

const linhas: string[] = [];
linhas.push("# Catálogo de indicadores — para aprovação\n");
linhas.push(`Gerado de \`src/lib/kpiCatalog/\`. Total: **${kpiCatalog.length}** itens.\n`);

const cards = kpiCatalog.filter((e) => e.kind === "card").length;
const graficos = kpiCatalog.filter((e) => e.kind === "chart").length;
const pendentes = kpiCatalog.filter((e) => e.pending).length;
linhas.push(`${cards} indicadores · ${graficos} gráficos, dos quais ${pendentes} aguardam componente próprio do painel.\n`);

linhas.push("## Resumo por área\n");
linhas.push("| Área | Indicadores | Gráficos | Aguardando |");
linhas.push("|---|---:|---:|---:|");
for (const area of Object.keys(NOME_AREA) as KpiArea[]) {
  const da = entradasDaArea(area);
  linhas.push(
    `| ${NOME_AREA[area]} | ${da.filter((e) => e.kind === "card").length} | ` +
    `${da.filter((e) => e.kind === "chart").length} | ${da.filter((e) => e.pending).length} |`,
  );
}

for (const area of Object.keys(NOME_AREA) as KpiArea[]) {
  const da = entradasDaArea(area);
  if (da.length === 0) continue;
  linhas.push(`\n## ${NOME_AREA[area]}\n`);
  linhas.push("| Item | Tipo | O que é | Origem | Situação |");
  linhas.push("|---|---|---|---|---|");
  for (const e of da) {
    const def = e.helpKey ? (kpiHelp[e.helpKey]?.definition ?? "") : "";
    const situacao = e.pending ? "aguarda gráfico" : e.helpKey ? "pronto" : "sem texto de ajuda";
    linhas.push(
      `| ${e.label} | ${e.kind === "card" ? "indicador" : "gráfico"} | ${def} | ` +
      `\`${e.source.provider}.${e.source.path}\` | ${situacao} |`,
    );
  }
}

const semVerbete = entradasSemVerbete();
linhas.push(`\n## Itens sem texto de ajuda (${semVerbete.length})\n`);
linhas.push("No painel aparecem sem o \"?\". Escrever o verbete é decisão sua, item a item.\n");
linhas.push(semVerbete.length ? semVerbete.map((id) => `- \`${id}\``).join("\n") : "Nenhum.");

const semEntrada = verbetesSemEntrada();
linhas.push(`\n## Verbetes do kpiHelp que nenhuma tela usa (${semEntrada.length})\n`);
linhas.push("Cada um é uma decisão: criar o indicador, ou apagar o verbete.\n");
linhas.push(semEntrada.length
  ? semEntrada.map((k) => `- \`${k}\` — ${kpiHelp[k]?.title ?? ""}`).join("\n")
  : "Nenhum.");

console.log(linhas.join("\n"));
