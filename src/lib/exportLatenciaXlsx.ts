import * as XLSX from "xlsx";
import type { AgenteRow } from "@/components/atendimento/useAtendimentoAgentes";
import type { LatenciaRespostaItem } from "@/components/atendimento/useAtendimentoLatenciaAgente";

/** Duração legível — a mesma leitura da tela, ao lado do valor em segundos. */
function fmtDur(s: number | null | undefined): string {
  if (!s || s <= 0) return "";
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${Math.round(s)}s`;
}

function num(v: number | null | undefined): number | string {
  return v === null || v === undefined ? "" : v;
}

/** `2026-09-16` — entra no nome do arquivo para o período não se perder. */
function dia(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Tira o que o Excel não aceita em nome de aba e o que atrapalha nome de arquivo. */
function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "agente";
}

function salvar(ws: XLSX.WorkSheet, aba: string, arquivo: string) {
  const wb = XLSX.utils.book_new();
  // Nome de aba do Excel: 31 caracteres, sem : \ / ? * [ ]
  XLSX.utils.book_append_sheet(wb, ws, aba.replace(/[:\\/?*[\]]/g, " ").slice(0, 31));
  XLSX.writeFile(wb, arquivo);
}

/** Uma linha por agente: as mesmas colunas do scorecard da aba Agentes. */
export function exportScorecardAgentesXlsx(params: {
  rows: AgenteRow[];
  from: Date;
  to: Date;
}) {
  const { rows, from, to } = params;

  const aoa: any[][] = [[
    "Agente", "Atendimentos", "Encerrados", "Pico simultâneos",
    "TMA (s)", "TMA", "1ª resposta (s)", "1ª resposta",
    "Latência (s)", "Latência", "Faixa mais comum",
    "CSAT", "CSAT respostas", "CSAT enviadas", "Reabertura (%)", "Msgs por atendimento",
  ]];

  for (const a of rows) {
    aoa.push([
      a.nome,
      a.total,
      a.encerrados,
      a.pico_simultaneos,
      num(a.tma_p50), fmtDur(a.tma_p50),
      num(a.frt_p50), fmtDur(a.frt_p50),
      num(a.latencia_p50), fmtDur(a.latencia_p50),
      a.latencia_faixa ?? "",
      num(a.csat),
      a.csat_n,
      a.csat_sent_n,
      num(a.reabertura_pct),
      num(a.msgs_atend),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 24 }, { wch: 13 }, { wch: 12 }, { wch: 16 },
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 },
    { wch: 12 }, { wch: 11 }, { wch: 16 },
    { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 15 }, { wch: 20 },
  ];

  salvar(ws, "Agentes", `atendimento_agentes_${dia(from)}_a_${dia(to)}.xlsx`);
}

/** Uma linha por resposta: o detalhe que formou a mediana de um agente. */
export function exportLatenciaAgenteXlsx(params: {
  nome: string;
  itens: LatenciaRespostaItem[];
  from: Date;
  to: Date;
}) {
  const { nome, itens, from, to } = params;

  const aoa: any[][] = [[
    "Agente", "Mensagem do cliente em", "Respondida em", "Latência (s)", "Latência",
    "No cálculo da mediana", "Contato", "Cliente", "Setor", "Grupo",
    "Mensagem do cliente", "Conversa (id)",
  ]];

  for (const i of itens) {
    aoa.push([
      nome,
      new Date(i.cli_first).toLocaleString("pt-BR"),
      new Date(i.agt_first).toLocaleString("pt-BR"),
      i.seg,
      fmtDur(i.seg),
      i.no_calculo ? "sim" : "nao",
      i.contato,
      i.cliente_nome ?? "",
      i.departamento ?? "",
      i.is_group ? "sim" : "nao",
      i.preview ?? "",
      i.conversation_id,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 22 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 11 },
    { wch: 20 }, { wch: 24 }, { wch: 28 }, { wch: 18 }, { wch: 8 },
    { wch: 50 }, { wch: 38 },
  ];

  salvar(ws, `Latência ${nome}`, `latencia_${slug(nome)}_${dia(from)}_a_${dia(to)}.xlsx`);
}

/** Os chats de uma célula do quadro Agente × Categoria (DEM-0315). */
export function exportChatsDaCelulaXlsx(params: {
  agente: string;
  categoria: string;
  itens: {
    attendance_code: string | null; contato: string; cliente_nome: string | null;
    opened_at: string; handle_seconds: number | null; no_calculo: boolean;
    categoria: string | null; subcategoria: string | null; conversation_id: string | null;
  }[];
  from: Date;
  to: Date;
}) {
  const { agente, categoria, itens, from, to } = params;
  const aoa: any[][] = [[
    "Agente", "Categoria", "Subcategoria", "Atendimento", "Aberto em", "Duração (s)", "Duração",
    "No cálculo do TMA", "Contato", "Cliente", "Conversa (id)",
  ]];
  for (const i of itens) {
    aoa.push([
      agente,
      i.categoria ?? "Sem categoria",
      i.subcategoria ?? "",
      i.attendance_code ?? "",
      new Date(i.opened_at).toLocaleString("pt-BR"),
      num(i.handle_seconds),
      fmtDur(i.handle_seconds),
      i.no_calculo ? "sim" : "nao",
      i.contato,
      i.cliente_nome ?? "",
      i.conversation_id ?? "",
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 20 }, { wch: 12 },
    { wch: 11 }, { wch: 17 }, { wch: 24 }, { wch: 28 }, { wch: 38 },
  ];
  salvar(ws, `${agente} ${categoria}`, `chats_${slug(agente)}_${slug(categoria)}_${dia(from)}_a_${dia(to)}.xlsx`);
}
