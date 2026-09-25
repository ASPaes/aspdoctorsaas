/**
 * Contas da Visão 360° do cliente. Tudo aqui é puro (sem Supabase) para dar
 * para testar: a tela busca as linhas uma vez por cliente e o filtro de período
 * é aplicado em memória. O cliente mais movimentado do sistema tem ~300
 * atendimentos e ~220 tickets (medido em 25/09/2026), então cabe folgado.
 */

export interface Atendimento360 {
  id: string;
  attendance_code: string | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  first_response_time_seconds: number | null;
  handle_seconds: number | null;
  assigned_to: string | null;
  department_id: string | null;
  departamento: string | null;
  contact_name: string | null;
  is_group: boolean;
  resolucao: string | null;
  ticket_id: string | null;
  ai_summary: string | null;
  ai_category: string | null;
  sentimento: string | null;
  conversation_id: string | null;
  csat_score: number | null;
  csat_reason: string | null;
  csat_respondido_em: string | null;
}

export interface Ticket360 {
  id: string;
  ticket_code: string | null;
  assunto: string;
  aberto_em: string;
  concluido_em: string | null;
  status_nome: string | null;
  status_cor: string | null;
  status_final: boolean;
  categoria: string | null;
  responsavel_user_id: string | null;
}

export interface Produto360 {
  id: string;
  produto: string;
  vlr_mensal: number;
  ativo: boolean;
  data_cancelamento: string | null;
  data_ativacao: string | null;
  data_venda: string | null;
  data_proximo_reajuste: string | null;
}

export interface Movimento360 {
  id: string;
  tipo: string;
  valor_delta: number;
  data_movimento: string;
  encerrado_em: string | null;
  descricao: string | null;
}

export interface Periodo {
  from: Date;
  to: Date;
}

const DIA = 86_400_000;

function dentro(iso: string | null | undefined, p: Periodo): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= p.from.getTime() && t <= p.to.getTime();
}

/** Mesmo tamanho de período, imediatamente antes. Base do "▲ x vs. anterior". */
export function periodoAnterior(p: Periodo): Periodo {
  const dur = p.to.getTime() - p.from.getTime();
  return { from: new Date(p.from.getTime() - dur - 1), to: new Date(p.from.getTime() - 1) };
}

/** yyyy-mm-dd no fuso de São Paulo (UTC-3 fixo, sem horário de verão desde 2019). */
export function diaSP(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * MRR do cliente numa data — espelho de `fn_mrr_cliente_em` no banco, para
 * desenhar os 12 meses sem 12 idas ao servidor:
 *   produtos vigentes (ativo, ou cancelado depois da data)
 *   + upsell/cross_sell/downsell/reajuste ativos até a data e não encerrados.
 * churn e reactivation NÃO entram: são extrato, não saldo (ver CLAUDE.md).
 * `movimentos` já chega filtrado (status ativo, sem estorno) pela consulta.
 */
export const TIPOS_SALDO = ["upsell", "cross_sell", "downsell", "reajuste"];

export function mrrEm(produtos: Produto360[], movimentos: Movimento360[], data: string): number {
  let total = 0;
  for (const p of produtos) {
    if (p.ativo || (p.data_cancelamento && p.data_cancelamento > data)) total += Number(p.vlr_mensal) || 0;
  }
  for (const m of movimentos) {
    if (!TIPOS_SALDO.includes(m.tipo)) continue;
    if (m.data_movimento > data) continue;
    if (m.encerrado_em && m.encerrado_em <= data) continue;
    total += Number(m.valor_delta) || 0;
  }
  return Math.round(total * 100) / 100;
}

/** Último dia de cada um dos 12 meses até `hoje` (o mês corrente entra como `hoje`). */
export function serieMrr12m(produtos: Produto360[], movimentos: Movimento360[], hoje: Date) {
  const out: { mes: string; valor: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ref = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 0);
    const data = i === 0 ? diaSP(hoje) : diaSP(new Date(ref.getTime() + 12 * 3_600_000));
    out.push({ mes: data.slice(0, 7), valor: mrrEm(produtos, movimentos, data) });
  }
  return out;
}

function media(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function kpisAtendimento(ats: Atendimento360[], p: Periodo) {
  const noPeriodo = ats.filter((a) => dentro(a.opened_at, p));
  const anterior = ats.filter((a) => dentro(a.opened_at, periodoAnterior(p)));
  const frt = noPeriodo.map((a) => a.first_response_time_seconds).filter((x): x is number => x != null && x >= 0);
  const tma = noPeriodo
    .filter((a) => a.status === "closed")
    .map((a) => a.handle_seconds)
    .filter((x): x is number => x != null && x > 0);
  const encerrados = noPeriodo.filter((a) => a.status === "closed");
  const resolvidos = encerrados.filter((a) => a.resolucao === "resolvido");
  const comResolucao = encerrados.filter((a) => a.resolucao);
  return {
    total: noPeriodo.length,
    totalAnterior: anterior.length,
    primeiraRespostaSeg: media(frt),
    tmaSeg: media(tma),
    abertosAgora: ats.filter((a) => a.status !== "closed").length,
    resolvidos: resolvidos.length,
    comResolucao: comResolucao.length,
  };
}

export function kpisCsat(ats: Atendimento360[], p: Periodo) {
  const notas = (lista: Atendimento360[]) =>
    lista.filter((a) => a.csat_score != null).map((a) => a.csat_score as number);
  const doPeriodo = (per: Periodo) => ats.filter((a) => dentro(a.csat_respondido_em ?? a.closed_at ?? a.opened_at, per));
  const atual = notas(doPeriodo(p));
  const ant = notas(doPeriodo(periodoAnterior(p)));
  const dist = [1, 2, 3, 4, 5].map((n) => ({ nota: n, qtd: atual.filter((x) => Math.round(x) === n).length }));
  return { media: media(atual), mediaAnterior: media(ant), qtd: atual.length, dist };
}

export function kpisTicket(tks: Ticket360[], p: Periodo) {
  const abertos = tks.filter((t) => !t.status_final);
  const maisAntigo = abertos.reduce<string | null>((acc, t) => (!acc || t.aberto_em < acc ? t.aberto_em : acc), null);
  const concluidos = tks.filter((t) => t.status_final && t.concluido_em && dentro(t.concluido_em, p));
  const dur = concluidos
    .map((t) => (new Date(t.concluido_em as string).getTime() - new Date(t.aberto_em).getTime()) / DIA)
    .filter((d) => d >= 0);
  const porCategoria = new Map<string, number>();
  for (const t of tks.filter((x) => dentro(x.aberto_em, p))) {
    const c = t.categoria || "Sem categoria";
    porCategoria.set(c, (porCategoria.get(c) ?? 0) + 1);
  }
  const top = [...porCategoria.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const abertosNoPeriodo = tks.filter((x) => dentro(x.aberto_em, p)).length;
  return {
    abertos: abertos.length,
    maisAntigoDias: maisAntigo ? Math.floor((Date.now() - new Date(maisAntigo).getTime()) / DIA) : null,
    concluidosNoPeriodo: concluidos.length,
    duracaoMediaDias: media(dur),
    categoriaTop: top ? { nome: top[0], pct: abertosNoPeriodo ? Math.round((top[1] / abertosNoPeriodo) * 100) : 0 } : null,
  };
}

/** Atendimentos por dia nos últimos 371 dias (53 semanas), chave yyyy-mm-dd. */
export function mapaDeContato(ats: Atendimento360[], hoje: Date) {
  const cont = new Map<string, number>();
  for (const a of ats) {
    const d = diaSP(new Date(a.opened_at));
    cont.set(d, (cont.get(d) ?? 0) + 1);
  }
  // Começa num domingo para as colunas serem semanas de verdade.
  const fim = new Date(hoje);
  const inicio = new Date(fim.getTime() - 52 * 7 * DIA);
  inicio.setDate(inicio.getDate() - inicio.getDay());
  const dias: { dia: string; qtd: number }[] = [];
  for (let t = inicio.getTime(); t <= fim.getTime(); t += DIA) {
    const dia = diaSP(new Date(t + 12 * 3_600_000));
    dias.push({ dia, qtd: cont.get(dia) ?? 0 });
  }
  return dias;
}

export type TipoEvento = "atendimento" | "avaliacao" | "ticket" | "contrato";

export interface Evento360 {
  id: string;
  tipo: TipoEvento;
  quando: string;
  titulo: string;
  detalhe: string | null;
  tags: { texto: string; tom: "ok" | "ruim" | "alerta" | "info" | "neutro" | "roxo" }[];
  citacao?: string | null;
  attendanceId?: string;
  ticketId?: string;
}

const RESOLUCAO: Record<string, { texto: string; tom: Evento360["tags"][number]["tom"] }> = {
  resolvido: { texto: "Resolvido", tom: "ok" },
  parcial: { texto: "Resolvido em parte", tom: "alerta" },
  nao_resolvido: { texto: "Não resolvido", tom: "ruim" },
  sem_resposta_cliente: { texto: "Cliente não respondeu", tom: "neutro" },
  sem_resposta_agente: { texto: "Sem resposta da equipe", tom: "ruim" },
};

export function rotuloResolucao(r: string | null) {
  return r ? RESOLUCAO[r] ?? { texto: r, tom: "neutro" as const } : null;
}

const MOV: Record<string, { titulo: string; tom: Evento360["tags"][number]["tom"] }> = {
  upsell: { titulo: "Upsell", tom: "ok" },
  cross_sell: { titulo: "Cross-sell", tom: "ok" },
  downsell: { titulo: "Downsell", tom: "ruim" },
  reajuste: { titulo: "Reajuste", tom: "alerta" },
  churn: { titulo: "Cancelamento", tom: "ruim" },
  reactivation: { titulo: "Reativação", tom: "ok" },
  venda_avulsa: { titulo: "Venda avulsa", tom: "info" },
};

export function minutos(seg: number | null | undefined): string {
  if (seg == null) return "—";
  if (seg < 60) return `${Math.round(seg)} s`;
  const m = Math.round(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")}`;
}

export function brl(v: number | null | undefined): string {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/* ---------------------------------------------- tabela de atendimentos */

export type ColunaAtendimento =
  | "codigo" | "aberto" | "contato" | "assunto" | "agente" | "setor" | "duracao" | "csat" | "resolucao";

export interface FiltrosAtendimento {
  codigo: string;
  contato: string;
  aberto: { de: string; ate: string };
  duracao: { min: string; max: string };
  assunto: string[];
  agente: string[];
  setor: string[];
  csat: string[];
  resolucao: string[];
}

export const FILTROS_ATENDIMENTO_VAZIOS: FiltrosAtendimento = {
  codigo: "", contato: "", aberto: { de: "", ate: "" }, duracao: { min: "", max: "" },
  assunto: [], agente: [], setor: [], csat: [], resolucao: [],
};

/** Valor da linha em cada coluna de opções — é o que o funil lista e compara. */
export function valorOpcaoAtendimento(
  a: Atendimento360,
  coluna: "assunto" | "agente" | "setor" | "csat" | "resolucao",
  nomeAgente: (uid: string | null) => string | null,
): string {
  switch (coluna) {
    case "assunto": return a.ai_category || "Sem assunto";
    case "agente": return nomeAgente(a.assigned_to) || "Sem agente";
    case "setor": return a.departamento || "Sem setor";
    case "csat": return a.csat_score != null ? `${Math.round(a.csat_score)} ★` : "Sem avaliação";
    case "resolucao":
      if (a.status !== "closed") return a.status === "waiting" ? "Na fila" : "Em atendimento";
      return rotuloResolucao(a.resolucao)?.texto ?? "Sem resolução";
  }
}

function contem(texto: string | null | undefined, termo: string) {
  if (!termo.trim()) return true;
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return n(texto ?? "").includes(n(termo.trim()));
}

function numero(txt: string): number | null {
  const v = Number(txt.replace(",", "."));
  return txt.trim() && Number.isFinite(v) ? v : null;
}

export function filtroAtendimentoAtivo(f: FiltrosAtendimento, c: keyof FiltrosAtendimento): boolean {
  const v = f[c];
  if (typeof v === "string") return !!v.trim();
  if (Array.isArray(v)) return v.length > 0;
  return Object.values(v).some((x) => !!x);
}

/**
 * Funis e ordenação da tabela de atendimentos. Vazio sempre vai para o fim,
 * nos dois sentidos: quem ordena por nota quer ver notas, não "—".
 */
export function filtrarOrdenarAtendimentos(
  lista: Atendimento360[],
  f: FiltrosAtendimento,
  ordem: { coluna: ColunaAtendimento; dir: "asc" | "desc" },
  nomeAgente: (uid: string | null) => string | null,
): Atendimento360[] {
  const durMin = numero(f.duracao.min), durMax = numero(f.duracao.max);
  const filtrada = lista.filter((a) => {
    if (!contem(a.attendance_code, f.codigo)) return false;
    if (!contem(a.contact_name, f.contato)) return false;
    const dia = diaSP(new Date(a.opened_at));
    if (f.aberto.de && dia < f.aberto.de) return false;
    if (f.aberto.ate && dia > f.aberto.ate) return false;
    if (durMin != null || durMax != null) {
      if (a.status !== "closed" || !a.handle_seconds) return false;
      const m = a.handle_seconds / 60;
      if (durMin != null && m < durMin) return false;
      if (durMax != null && m > durMax) return false;
    }
    for (const c of ["assunto", "agente", "setor", "csat", "resolucao"] as const) {
      if (f[c].length && !f[c].includes(valorOpcaoAtendimento(a, c, nomeAgente))) return false;
    }
    return true;
  });

  const chave = (a: Atendimento360): string | number | null => {
    switch (ordem.coluna) {
      case "codigo": return a.attendance_code;
      case "aberto": return a.opened_at;
      case "contato": return a.contact_name;
      case "assunto": return a.ai_category || a.ai_summary;
      case "agente": return nomeAgente(a.assigned_to);
      case "setor": return a.departamento;
      case "duracao": return a.status === "closed" && a.handle_seconds ? a.handle_seconds : null;
      case "csat": return a.csat_score;
      case "resolucao": return valorOpcaoAtendimento(a, "resolucao", nomeAgente);
    }
  };
  const sinal = ordem.dir === "asc" ? 1 : -1;
  return [...filtrada].sort((a, b) => {
    const x = chave(a), y = chave(b);
    const vx = x == null || x === "", vy = y == null || y === "";
    if (vx || vy) return vx === vy ? 0 : vx ? 1 : -1;
    const r = typeof x === "number" && typeof y === "number"
      ? x - y
      : String(x).localeCompare(String(y), "pt-BR", { numeric: true, sensitivity: "base" });
    return r * sinal;
  });
}

export function montarLinhaDoTempo(
  ats: Atendimento360[],
  tks: Ticket360[],
  movs: Movimento360[],
  nomeAgente: (uid: string | null) => string | null,
  p: Periodo,
): Evento360[] {
  const ev: Evento360[] = [];

  for (const a of ats) {
    const agente = nomeAgente(a.assigned_to);
    const base = [a.ai_category || null, a.departamento, agente].filter(Boolean).join(" · ");
    if (a.status === "closed" && a.closed_at && dentro(a.closed_at, p)) {
      const tags: Evento360["tags"] = [];
      const r = rotuloResolucao(a.resolucao);
      if (r) tags.push(r);
      if (a.first_response_time_seconds != null) tags.push({ texto: `1ª resp. ${minutos(a.first_response_time_seconds)}`, tom: "neutro" });
      if (a.handle_seconds) tags.push({ texto: minutos(a.handle_seconds), tom: "neutro" });
      if (a.ticket_id) tags.push({ texto: "Virou ticket", tom: "info" });
      if (a.is_group) tags.push({ texto: "Grupo", tom: "info" });
      ev.push({
        id: `a-${a.id}`, tipo: "atendimento", quando: a.closed_at,
        titulo: `Atendimento ${a.attendance_code ?? ""} encerrado`.replace("  ", " "),
        detalhe: a.ai_summary || base || a.contact_name, tags, attendanceId: a.id,
      });
    } else if (a.status !== "closed" && dentro(a.opened_at, p)) {
      ev.push({
        id: `a-${a.id}`, tipo: "atendimento", quando: a.opened_at,
        titulo: `Atendimento ${a.attendance_code ?? ""} ${a.status === "waiting" ? "na fila" : "em andamento"}`,
        detalhe: [a.contact_name, base].filter(Boolean).join(" · ") || null,
        tags: [{ texto: a.status === "waiting" ? "Aguardando" : "Em atendimento", tom: "info" }],
        attendanceId: a.id,
      });
    }
    if (a.csat_score != null) {
      const q = a.csat_respondido_em ?? a.closed_at ?? a.opened_at;
      if (dentro(q, p)) {
        const nota = a.csat_score;
        ev.push({
          id: `c-${a.id}`, tipo: "avaliacao", quando: q,
          titulo: `Avaliação ${nota} ★${agente ? ` para ${agente}` : ""}`,
          detalhe: a.attendance_code ? `Atendimento ${a.attendance_code}` : null,
          citacao: a.csat_reason || null,
          tags: nota <= 2 ? [{ texto: "Detrator", tom: "ruim" }] : nota >= 5 ? [{ texto: "Promotor", tom: "ok" }] : [],
          attendanceId: a.id,
        });
      }
    }
  }

  for (const t of tks) {
    if (dentro(t.aberto_em, p)) {
      ev.push({
        id: `t-${t.id}-a`, tipo: "ticket", quando: t.aberto_em,
        titulo: `${t.ticket_code ?? "Ticket"} aberto`, detalhe: t.assunto,
        tags: [
          ...(t.status_nome && !t.status_final ? [{ texto: t.status_nome, tom: "info" as const }] : []),
          ...(t.categoria ? [{ texto: t.categoria, tom: "neutro" as const }] : []),
        ],
        ticketId: t.id,
      });
    }
    if (t.status_final && t.concluido_em && dentro(t.concluido_em, p)) {
      ev.push({
        id: `t-${t.id}-f`, tipo: "ticket", quando: t.concluido_em,
        titulo: `${t.ticket_code ?? "Ticket"} ${t.status_nome ? t.status_nome.toLowerCase() : "encerrado"}`,
        detalhe: t.assunto, tags: [{ texto: "Encerrado", tom: "ok" }], ticketId: t.id,
      });
    }
  }

  for (const m of movs) {
    // data_movimento é date puro: meio-dia de SP para não cair no dia anterior.
    const quando = `${m.data_movimento}T15:00:00Z`;
    if (!dentro(quando, p)) continue;
    const info = MOV[m.tipo] ?? { titulo: m.tipo, tom: "neutro" as const };
    const v = Number(m.valor_delta) || 0;
    ev.push({
      id: `m-${m.id}`, tipo: "contrato", quando,
      titulo: info.titulo,
      detalhe: [m.descricao, v ? `${v > 0 ? "+" : "−"} ${brl(Math.abs(v))}/mês` : null].filter(Boolean).join(" · ") || null,
      tags: [{ texto: info.titulo, tom: info.tom }],
    });
  }

  return ev.sort((a, b) => (a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0));
}
