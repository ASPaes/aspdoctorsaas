/**
 * Contas puras da Visão 360° do colaborador. O servidor (RPC
 * `get_colaborador_360`) devolve, para cada métrica, o `pct`: a fração do
 * grupo de comparação que o agente iguala ou supera, já na direção "melhor".
 * Aqui esses pct viram a nota de 0 a 100.
 */

export type Dimensao = "satisfacao" | "agilidade" | "resolucao" | "produtividade" | "qualidade";

export interface Metricas360 {
  user_id: string;
  elegivel: boolean;
  grupo: "setor" | "tenant";
  encerrados: number;
  frt_p50: number | null;
  tma_p50: number | null;
  csat: number | null;
  csat_n: number;
  csat_satisfeitos: number;
  csat_enviados: number;
  fcr_pct: number | null;
  fcr_n: number;
  fcr_base: number;
  ia_n: number;
  reabertura_pct: number | null;
  qualidade: number | null;
  sent_pos: number;
  sent_neu: number;
  sent_neg: number;
  tk_resolvidos: number;
  tk_dias_medio: number | null;
  n: number | null;
  pct: Partial<Record<"csat" | "frt" | "tma" | "fcr" | "encerrados" | "qualidade" | "tickets", number | null>>;
  pos: Partial<Record<"csat" | "frt" | "tma" | "fcr" | "encerrados" | "tickets", number | null>>;
}

export interface Time360 {
  n: number;
  encerrados: number | null;
  csat: number | null;
  frt_p50: number | null;
  tma_p50: number | null;
  fcr_pct: number | null;
  reabertura_pct: number | null;
  qualidade: number | null;
  tk_resolvidos: number | null;
  encerrados_max: number | null;
}

export const DIMENSOES: { chave: Dimensao; rotulo: string; peso: number; fonte: keyof Metricas360["pct"]; regra: string }[] = [
  { chave: "satisfacao", rotulo: "Satisfação", peso: 25, fonte: "csat", regra: "Média das notas de CSAT recebidas." },
  { chave: "agilidade", rotulo: "Agilidade", peso: 20, fonte: "frt", regra: "Mediana da 1ª resposta, contando só o horário de atendimento do setor. Quanto menor, melhor." },
  { chave: "resolucao", rotulo: "Resolução", peso: 20, fonte: "fcr", regra: "Resolvidos no 1º contato: sem ticket, sem transferência e sem reabrir." },
  { chave: "produtividade", rotulo: "Produtividade", peso: 20, fonte: "encerrados", regra: "Atendimentos encerrados no período." },
  { chave: "qualidade", rotulo: "Qualidade", peso: 15, fonte: "qualidade", regra: "Sentimento das conversas lido pela IA no encerramento." },
];

export const FAIXAS_NOTA = [
  { de: 80, ate: 100, rotulo: "Destaque", cor: "#22C55E" },
  { de: 60, ate: 79, rotulo: "No ritmo", cor: "#0EA5E9" },
  { de: 40, ate: 59, rotulo: "Atenção", cor: "#F59E0B" },
  { de: 0, ate: 39, rotulo: "Precisa de apoio", cor: "#EF4444" },
] as const;

export const MIN_ENCERRADOS = 5;

export function faixaDaNota(nota: number) {
  return FAIXAS_NOTA.find((f) => nota >= f.de) ?? FAIXAS_NOTA[FAIXAS_NOTA.length - 1];
}

export interface Nota360 {
  nota: number | null;
  faixa: (typeof FAIXAS_NOTA)[number] | null;
  fatores: { chave: Dimensao; rotulo: string; regra: string; nota: number | null; peso: number; pesoEfetivo: number }[];
}

/**
 * Nota = média ponderada das dimensões com dado. Dimensão sem dado (ex.: ninguém
 * avaliou) sai da conta e o peso dela se redistribui entre as outras.
 * Sem atendimentos suficientes no período, não há nota.
 */
export function calcularNota(m: Metricas360 | null | undefined): Nota360 {
  const base = DIMENSOES.map((d) => {
    const p = m?.elegivel ? m.pct?.[d.fonte] : null;
    return { chave: d.chave, rotulo: d.rotulo, regra: d.regra, peso: d.peso, nota: p == null ? null : Math.round(p * 100) };
  });
  const somaPesos = base.reduce((s, f) => s + (f.nota == null ? 0 : f.peso), 0);
  if (!m?.elegivel || somaPesos === 0) {
    return { nota: null, faixa: null, fatores: base.map((f) => ({ ...f, pesoEfetivo: 0 })) };
  }
  const fatores = base.map((f) => ({ ...f, pesoEfetivo: f.nota == null ? 0 : Math.round((f.peso / somaPesos) * 100) }));
  const nota = Math.round(base.reduce((s, f) => s + (f.nota == null ? 0 : f.nota * f.peso), 0) / somaPesos);
  return { nota, faixa: faixaDaNota(nota), fatores };
}

/** "2º de 6". Sem posição (métrica sem dado ou fora do grupo), null. */
export function posicao(pos: number | null | undefined, n: number | null | undefined): string | null {
  if (!pos || !n) return null;
  return `${pos}º de ${n}`;
}

/**
 * Diferença relativa contra o time, já na direção "melhor".
 * `menorMelhor` para tempos. Devolve null quando não há como comparar.
 */
export function vsTime(valor: number | null | undefined, time: number | null | undefined, menorMelhor = false) {
  if (valor == null || time == null || time === 0) return null;
  const rel = (valor - time) / Math.abs(time);
  const melhor = menorMelhor ? rel < 0 : rel > 0;
  return { pct: Math.round(Math.abs(rel) * 100), melhor, igual: Math.abs(rel) < 0.005 };
}

/** Segundos em texto curto: 52s, 1m 48s, 1h 05m. */
export function fmtTempo(s: number | null | undefined): string {
  if (s == null || s <= 0) return "sem dado";
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  if (s >= 60) {
    const seg = Math.round(s % 60);
    return seg ? `${Math.floor(s / 60)}m ${String(seg).padStart(2, "0")}s` : `${Math.floor(s / 60)} min`;
  }
  return `${Math.round(s)}s`;
}

export function fmtNum(v: number | null | undefined, casas = 0): string {
  if (v == null) return "sem dado";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Rótulo e cor do status ao vivo. */
export function statusAoVivo(presenca: string | null | undefined, ultimoSinal: string | null | undefined, agora = new Date()) {
  const vivo = ultimoSinal ? agora.getTime() - new Date(ultimoSinal).getTime() < 5 * 60_000 : false;
  if (presenca === "active" && vivo) return { rotulo: "Online", cor: "#22C55E", pulsa: true };
  if (presenca === "paused") return { rotulo: "Em pausa", cor: "#F59E0B", pulsa: true };
  if (presenca === "active") return { rotulo: "Sem sinal", cor: "#94A3B8", pulsa: false };
  return { rotulo: "Offline", cor: "#94A3B8", pulsa: false };
}

export function iniciais(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return ((p[0][0] ?? "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
}
