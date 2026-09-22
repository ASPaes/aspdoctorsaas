import { baixarPlanilha, dataCell, hojeISO, slugArquivo } from "@/lib/xlsxExport";
import { formatMinUtil, formatMinCal } from "@/pages/onboarding/slaFormat";
import type { LinhaDrilldown } from "@/pages/onboarding/DrilldownSheet";
import type { ClientePermanencia } from "@/pages/onboarding/permanencia";

/**
 * Exportação das listas de clientes que abrem ao clicar num card do SLA de
 * Onboarding (Pipeline, Etapa, Responsável, Área e Tempo de entrega) e do card
 * de Permanência.
 *
 * As linhas chegam JÁ ordenadas como a tela as mostra, de propósito: a planilha
 * é a conferência do que está na tela, e reordenar aqui abriria espaço para os
 * dois divergirem.
 *
 * Cada duração sai duas vezes: o texto que a tela mostra ("2d 2h") e os minutos
 * crus. Só o texto não ordena nem soma no Excel, que é para o que a planilha
 * serve. As duas bases não se misturam: expediente conta 8h por dia, calendário
 * conta 24h (ver slaFormat.ts).
 */
export function exportDrilldownSlaXlsx(params: {
  /** Título do painel, ex. "Conferência · Onboarding PDV". Vira nome do arquivo. */
  titulo: string;
  linhas: LinhaDrilldown[];
}): void {
  const { titulo, linhas } = params;

  baixarPlanilha({
    colunas: [
      { header: "Cliente", wch: 38 },
      { header: "Responsável", wch: 24 },
      { header: "Expediente", wch: 14 },
      { header: "Expediente (min)", wch: 16 },
      { header: "Calendário", wch: 14 },
      { header: "Calendário (min)", wch: 16 },
      { header: "% SLA", wch: 10 },
    ],
    linhas: linhas.map((l) => [
      l.cliente,
      l.responsavel,
      l.util == null ? "" : formatMinUtil(l.util),
      l.util ?? "",
      l.cal == null ? "" : formatMinCal(l.cal),
      l.cal ?? "",
      l.pctSla ?? "",
    ]),
    aba: titulo || "SLA",
    arquivo: `sla_${slugArquivo(titulo, "onboarding")}_${hojeISO()}.xlsx`,
  });
}

/**
 * Lista da permanência. "Dias" fica vazio para quem continua na base — em vez de
 * zero, que o Excel somaria e a média puxaria para baixo. Quem não saiu é
 * identificado pela coluna Situação.
 */
export function exportDrilldownPermanenciaXlsx(params: {
  titulo: string;
  linhas: ClientePermanencia[];
  nomeCliente: (journeyId: string) => string;
  nomeImplantador: (userId: string | null) => string;
}): void {
  const { titulo, linhas, nomeCliente, nomeImplantador } = params;

  baixarPlanilha({
    colunas: [
      { header: "Cliente", wch: 38 },
      { header: "Implantador", wch: 24 },
      { header: "Entrega", wch: 12, z: "dd/mm/yyyy" },
      { header: "Saída", wch: 12, z: "dd/mm/yyyy" },
      { header: "Dias", wch: 8 },
      { header: "Situação", wch: 12 },
    ],
    linhas: linhas.map((c) => [
      nomeCliente(c.journeyId),
      nomeImplantador(c.implantadorId),
      dataCell(c.entrega),
      dataCell(c.saida),
      c.dias ?? "",
      c.dias == null ? "na base" : "saiu",
    ]),
    aba: titulo || "Permanência",
    arquivo: `permanencia_${slugArquivo(titulo, "onboarding")}_${hojeISO()}.xlsx`,
  });
}
