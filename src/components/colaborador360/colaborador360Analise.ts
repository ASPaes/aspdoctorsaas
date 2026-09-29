/**
 * Contas da Visão geral e da Linha do tempo da Visão 360° do colaborador.
 * Tudo sai dos atendimentos, tickets e da jornada já carregados na tela, sem
 * consulta nova. Datas e horas sempre no fuso de São Paulo.
 */
import type { Atendimento360 } from "@/components/clientes/visao360/visao360Calc";
import type { AtendimentoJornada } from "@/components/atendimento/useAtendimentoJornada";
import type { Metricas360 } from "./colaborador360Calc";

export interface TicketLinha {
  id: string;
  ticket_code: string | null;
  assunto: string;
  aberto_em: string;
  concluido_em: string | null;
  status_final: boolean;
  responsavel_user_id: string | null;
  criado_por: string | null;
  cliente?: string | null;
}

const FUSO = "America/Sao_Paulo";
const fmtDia = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const fmtHora = new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hour12: false });
const fmtSemana = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short" });
const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** "2026-09-28" no fuso de São Paulo. */
export const diaSP = (d: Date) => fmtDia.format(d);
export const horaSP = (d: Date) => Number(fmtHora.format(d)) % 24;
/** 0 = segunda ... 6 = domingo, no fuso de São Paulo. */
export const diaDaSemanaSP = (d: Date) => DOW[fmtSemana.format(d)] ?? 0;

/** Segunda-feira da semana do dia (texto yyyy-mm-dd). */
export function inicioDaSemana(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  const u = new Date(Date.UTC(y, m - 1, d));
  const dow = (u.getUTCDay() + 6) % 7;
  u.setUTCDate(u.getUTCDate() - dow);
  return u.toISOString().slice(0, 10);
}

export interface Semana { inicio: string; atendimentos: number; csat: number | null; notas: number }

/** Atendimentos abertos e média de CSAT por semana, da mais antiga para a mais nova, sem buracos. */
export function porSemana(ats: Atendimento360[], de: Date, ate: Date): Semana[] {
  const mapa = new Map<string, { n: number; soma: number; notas: number }>();
  for (let s = inicioDaSemana(diaSP(de)); s <= diaSP(ate); ) {
    mapa.set(s, { n: 0, soma: 0, notas: 0 });
    const [y, m, d] = s.split("-").map(Number);
    s = new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  }
  for (const a of ats) {
    const t = new Date(a.opened_at);
    if (t < de || t > ate) continue;
    const k = inicioDaSemana(diaSP(t));
    const g = mapa.get(k);
    if (!g) continue;
    g.n++;
    if (a.csat_score != null) { g.soma += a.csat_score; g.notas++; }
  }
  return [...mapa.entries()].map(([inicio, g]) => ({
    inicio, atendimentos: g.n, notas: g.notas, csat: g.notas ? Math.round((g.soma / g.notas) * 100) / 100 : null,
  }));
}

export const HORAS_MAPA = Array.from({ length: 14 }, (_, i) => i + 7); // 7h às 20h

/** Contagem [dia da semana][hora] dos atendimentos abertos no período. Fora de 7h-20h cai na borda. */
export function mapaDeHorarios(ats: Atendimento360[], de: Date, ate: Date): { grade: number[][]; max: number } {
  const grade = Array.from({ length: 7 }, () => HORAS_MAPA.map(() => 0));
  let max = 0;
  for (const a of ats) {
    const t = new Date(a.opened_at);
    if (t < de || t > ate) continue;
    const h = Math.min(20, Math.max(7, horaSP(t))) - 7;
    const d = diaDaSemanaSP(t);
    grade[d][h]++;
    max = Math.max(max, grade[d][h]);
  }
  return { grade, max };
}

export interface Assunto { nome: string; n: number; pct: number; csat: number | null; notas: number }

/** Assuntos mais atendidos (categoria da IA), com o CSAT de cada um. */
export function assuntos(ats: Atendimento360[], de: Date, ate: Date, limite = 6): Assunto[] {
  const doPeriodo = ats.filter((a) => { const t = new Date(a.opened_at); return t >= de && t <= ate; });
  const mapa = new Map<string, { n: number; soma: number; notas: number }>();
  for (const a of doPeriodo) {
    const k = a.ai_category || "Sem assunto";
    const g = mapa.get(k) ?? { n: 0, soma: 0, notas: 0 };
    g.n++;
    if (a.csat_score != null) { g.soma += a.csat_score; g.notas++; }
    mapa.set(k, g);
  }
  const total = doPeriodo.length || 1;
  return [...mapa.entries()]
    .sort((x, y) => y[1].n - x[1].n)
    .slice(0, limite)
    .map(([nome, g]) => ({
      nome, n: g.n, pct: Math.round((g.n / total) * 100), notas: g.notas,
      csat: g.notas ? Math.round((g.soma / g.notas) * 10) / 10 : null,
    }));
}

export interface Destaque { tom: "ok" | "info" | "alerta" | "ruim"; titulo: string; sub: string }

/** Pausas acima do previsto: soma do excedente, só das pausas com previsão declarada. */
export function excessoDePausa(j: AtendimentoJornada | null | undefined) {
  if (!j) return { segundos: 0, pausas: 0, porMotivo: new Map<string, number>() };
  let segundos = 0, pausas = 0;
  const porMotivo = new Map<string, number>();
  for (const p of j.pausas) {
    if (p.previsto_min == null || p.em_andamento) continue;
    const extra = p.segundos - p.previsto_min * 60;
    if (extra > 60) {
      segundos += extra;
      pausas++;
      porMotivo.set(p.motivo, (porMotivo.get(p.motivo) ?? 0) + extra);
    }
  }
  return { segundos, pausas, porMotivo };
}

const hm = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
};

/**
 * Pontos fortes e de atenção. No máximo 2 de cada, do mais forte para o mais
 * fraco. Só afirma o que o dado sustenta (posição com grupo de 3+, CSAT com 3+ notas).
 */
export function destaques(
  m: Metricas360 | null | undefined,
  ats: Atendimento360[],
  de: Date,
  ate: Date,
  jornada: AtendimentoJornada | null | undefined,
  ticketsParados: number,
): Destaque[] {
  const fortes: Destaque[] = [];
  const atencao: Destaque[] = [];
  const grupo = m?.grupo === "tenant" ? "da empresa" : "do setor";
  if (m?.elegivel && (m.n ?? 0) >= 3) {
    if (m.pos?.frt === 1) fortes.push({ tom: "ok", titulo: `1ª resposta mais rápida ${grupo}`, sub: `entre ${m.n} pessoas com nota` });
    if (m.pos?.csat === 1) fortes.push({ tom: "ok", titulo: `Melhor CSAT ${grupo}`, sub: `${m.csat_n} avaliações no período` });
    if (m.pos?.encerrados === 1) fortes.push({ tom: "ok", titulo: `Quem mais atendeu ${grupo}`, sub: `${m.encerrados} atendimentos encerrados` });
    if (m.pos?.fcr === 1) fortes.push({ tom: "ok", titulo: `Quem mais resolve no 1º contato`, sub: `${m.fcr_pct}% dos atendimentos` });
  }
  const doPeriodo = ats.filter((a) => { const t = new Date(a.opened_at); return t >= de && t <= ate; });
  const elogios = doPeriodo.filter((a) => a.csat_score === 5 && a.csat_reason).length;
  if (elogios >= 2) fortes.push({ tom: "info", titulo: `${elogios} elogios de clientes`, sub: "notas 5 com comentário" });

  const ruim = assuntos(ats, de, ate, 20).filter((x) => x.notas >= 3 && x.csat != null && x.csat < 4).sort((a, b) => a.csat! - b.csat!)[0];
  if (ruim) atencao.push({ tom: "ruim", titulo: `CSAT cai para ${ruim.csat!.toFixed(1).replace(".", ",")} em ${ruim.nome}`, sub: `${ruim.notas} avaliações nesse assunto` });
  const baixas = doPeriodo.filter((a) => a.csat_score != null && a.csat_score <= 2).length;
  if (baixas >= 2 && !ruim) atencao.push({ tom: "ruim", titulo: `${baixas} notas baixas no período`, sub: "notas 1 e 2" });
  const ex = excessoDePausa(jornada);
  if (ex.segundos >= 30 * 60) {
    const top = [...ex.porMotivo.entries()].sort((a, b) => b[1] - a[1])[0];
    atencao.push({ tom: "alerta", titulo: `Pausas ${hm(ex.segundos)} acima do previsto`, sub: top ? `a maior parte em ${top[0]}` : `${ex.pausas} pausas` });
  }
  if (ticketsParados > 0) atencao.push({ tom: "alerta", titulo: `${ticketsParados} ticket${ticketsParados > 1 ? "s" : ""} parado${ticketsParados > 1 ? "s" : ""} há mais de 7 dias`, sub: "abertos com a pessoa" });

  return [...fortes.slice(0, 2), ...atencao.slice(0, 2)];
}

export type TipoEvento = "atendimentos" | "avaliacao" | "ticket" | "pausa";
export interface EventoLinha {
  quando: string;
  tipo: TipoEvento;
  titulo: string;
  detalhe?: string;
  tom?: "ok" | "ruim" | "alerta" | "info" | "neutro";
  ref?: { atendimento?: string; ticket?: string };
}
export interface DiaLinha { dia: string; eventos: EventoLinha[] }

/**
 * Linha do tempo do período, do dia mais novo para o mais antigo. Atendimento
 * vira um resumo por dia (são dezenas); avaliação, ticket e pausa acima do
 * previsto aparecem um a um, porque é neles que o gestor quer clicar.
 */
export function linhaDoTempo(
  ats: Atendimento360[],
  tickets: TicketLinha[],
  jornada: AtendimentoJornada | null | undefined,
  userId: string,
  de: Date,
  ate: Date,
): DiaLinha[] {
  const dentro = (iso: string | null) => { if (!iso) return false; const t = new Date(iso); return t >= de && t <= ate; };
  const ev: EventoLinha[] = [];

  const porDia = new Map<string, { n: number; ultimo: string; resolvidos: number }>();
  for (const a of ats) {
    if (a.status !== "closed" || !dentro(a.closed_at)) continue;
    const k = diaSP(new Date(a.closed_at!));
    const g = porDia.get(k) ?? { n: 0, ultimo: a.closed_at!, resolvidos: 0 };
    g.n++;
    if (a.resolucao === "resolvido") g.resolvidos++;
    if (a.closed_at! > g.ultimo) g.ultimo = a.closed_at!;
    porDia.set(k, g);
  }
  for (const [, g] of porDia) {
    ev.push({
      quando: g.ultimo, tipo: "atendimentos",
      titulo: `${g.n} atendimento${g.n > 1 ? "s" : ""} encerrado${g.n > 1 ? "s" : ""}`,
      detalhe: g.resolvidos ? `${g.resolvidos} marcado${g.resolvidos > 1 ? "s" : ""} como resolvido pela IA` : undefined,
    });
  }

  for (const a of ats) {
    if (a.csat_score == null) continue;
    const q = a.csat_respondido_em ?? a.closed_at ?? a.opened_at;
    if (!dentro(q)) continue;
    ev.push({
      quando: q, tipo: "avaliacao",
      titulo: `Avaliação ${a.csat_score}★${a.rotulo_pessoa ? ` de ${a.rotulo_pessoa}` : ""}`,
      detalhe: a.csat_reason ? `"${a.csat_reason}"` : undefined,
      tom: a.csat_score <= 2 ? "ruim" : a.csat_score >= 4 ? "ok" : "neutro",
      ref: { atendimento: a.id },
    });
  }

  for (const t of tickets) {
    if (t.criado_por === userId && dentro(t.aberto_em)) {
      ev.push({ quando: t.aberto_em, tipo: "ticket", titulo: `Abriu ${t.ticket_code ?? "ticket"}`, detalhe: [t.cliente, t.assunto].filter(Boolean).join(" · "), tom: "info", ref: { ticket: t.id } });
    }
    if (t.responsavel_user_id === userId && t.status_final && dentro(t.concluido_em)) {
      ev.push({ quando: t.concluido_em!, tipo: "ticket", titulo: `Concluiu ${t.ticket_code ?? "ticket"}`, detalhe: [t.cliente, t.assunto].filter(Boolean).join(" · "), tom: "ok", ref: { ticket: t.id } });
    }
  }

  for (const p of jornada?.pausas ?? []) {
    if (p.previsto_min == null || p.em_andamento || !dentro(p.inicio)) continue;
    const extra = Math.round((p.segundos - p.previsto_min * 60) / 60);
    if (extra < 5) continue;
    ev.push({
      quando: p.inicio, tipo: "pausa",
      titulo: `Pausa ${p.motivo}: ${Math.round(p.segundos / 60)} min`,
      detalhe: `previsto ${p.previsto_min} min, ${extra} min a mais${p.estimada ? " (fim estimado)" : ""}`,
      tom: "alerta",
    });
  }

  ev.sort((a, b) => (a.quando < b.quando ? 1 : -1));
  const dias: DiaLinha[] = [];
  for (const e of ev) {
    const d = diaSP(new Date(e.quando));
    const ult = dias[dias.length - 1];
    if (ult?.dia === d) ult.eventos.push(e);
    else dias.push({ dia: d, eventos: [e] });
  }
  return dias;
}
