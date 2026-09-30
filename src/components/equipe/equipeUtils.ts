import type { Conversa, Mensagem, Pessoa } from "./tipos";

const TZ = "America/Sao_Paulo";

export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

// Cores com contraste para texto branco nos dois temas.
const CORES = ["#0EA5E9", "#8B5CF6", "#F97316", "#EC4899", "#14B8A6", "#6366F1", "#EAB308", "#EF4444", "#22C55E", "#64748B"];

/** Mesma pessoa, mesma cor, em qualquer tela. */
export function corDoUsuario(id: string | null | undefined): string {
  if (!id) return "#64748B";
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return CORES[h % CORES.length];
}

export type TomPresenca = "livre" | "ocupado" | "pausa" | "offline";

/** Presença pela operação real: turno, pausa e atendimentos em andamento. */
export function presencaDe(p: Pessoa | undefined): { texto: string; tom: TomPresenca } {
  if (!p || p.presenca === "offline") return { texto: "Fora do turno", tom: "offline" };
  if (p.presenca === "paused") return { texto: p.pausa ? `Em pausa: ${p.pausa}` : "Em pausa", tom: "pausa" };
  if (p.atendimentos > 0) {
    return { texto: `Em atendimento (${p.atendimentos})`, tom: "ocupado" };
  }
  return { texto: "Disponível", tom: "livre" };
}

export const COR_PRESENCA: Record<TomPresenca, string> = {
  livre: "bg-emerald-500",
  ocupado: "bg-sky-500",
  pausa: "bg-amber-500",
  offline: "bg-slate-400",
};

export function nomeDaConversa(c: Conversa, pessoas: Map<string, Pessoa>): string {
  if (c.tipo === "dm" || c.tipo === "grupo") {
    const nomes = c.outros.map((id) => pessoas.get(id)?.nome ?? "Colaborador");
    if (nomes.length === 0) return "Só você";
    if (c.tipo === "dm") return nomes[0];
    return nomes.map((n) => n.split(" ")[0]).join(", ");
  }
  return c.nome ?? "";
}

/** "geral" e canais manuais levam #; setor aparece com o nome do setor. */
export function prefixoCanal(c: Pick<Conversa, "tipo">): string {
  return c.tipo === "geral" || c.tipo === "canal" ? "#" : "";
}

function diaSP(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ }); // AAAA-MM-DD
}

export function rotuloDia(iso: string, agora = new Date()): string {
  const d = new Date(iso);
  const dia = diaSP(d);
  if (dia === diaSP(agora)) return "Hoje";
  const ontem = new Date(agora.getTime() - 86_400_000);
  if (dia === diaSP(ontem)) return "Ontem";
  const mesmoAno = d.toLocaleDateString("pt-BR", { timeZone: TZ, year: "numeric" }) ===
    agora.toLocaleDateString("pt-BR", { timeZone: TZ, year: "numeric" });
  return d.toLocaleDateString("pt-BR", {
    timeZone: TZ, weekday: "long", day: "numeric", month: "long",
    ...(mesmoAno ? {} : { year: "numeric" }),
  });
}

export function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

/** Hora curta para a lista: hoje = hora; esta semana = dia; antes = data. */
export function horaCurta(iso: string | null, agora = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (diaSP(d) === diaSP(agora)) return hora(iso);
  if (diaSP(d) === diaSP(new Date(agora.getTime() - 86_400_000))) return "ontem";
  if (agora.getTime() - d.getTime() < 6 * 86_400_000) {
    return d.toLocaleDateString("pt-BR", { timeZone: TZ, weekday: "short" }).replace(".", "");
  }
  return d.toLocaleDateString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
}

export type ItemLinha =
  | { tipo: "dia"; chave: string; rotulo: string }
  | { tipo: "novas"; chave: string }
  | { tipo: "msg"; chave: string; msg: Mensagem; continuacao: boolean };

const JANELA_AGRUPAR_MS = 5 * 60_000;

/**
 * Monta a linha do tempo: divisória por dia, divisória "novas mensagens" no
 * ponto em que a pessoa parou de ler, e agrupamento de mensagens seguidas do
 * mesmo autor (até 5 min) para não repetir nome e foto.
 * `msgs` em ordem crescente de data.
 */
export function montarLinhaDoTempo(
  msgs: Mensagem[],
  opts: { lidoAte?: string | null; eu?: string | null; agora?: Date } = {},
): ItemLinha[] {
  const itens: ItemLinha[] = [];
  let diaAnterior = "";
  let anterior: Mensagem | null = null;
  let marcouNovas = false;
  const lido = opts.lidoAte ? new Date(opts.lidoAte).getTime() : null;

  for (const m of msgs) {
    const dia = diaSP(new Date(m.created_at));
    let quebrou = false;
    if (dia !== diaAnterior) {
      itens.push({ tipo: "dia", chave: `dia-${dia}`, rotulo: rotuloDia(m.created_at, opts.agora) });
      diaAnterior = dia;
      quebrou = true;
    }
    if (!marcouNovas && lido !== null && m.autor_id !== opts.eu && !m._pendente
        && new Date(m.created_at).getTime() > lido) {
      itens.push({ tipo: "novas", chave: "novas" });
      marcouNovas = true;
      quebrou = true;
    }
    const continuacao = !quebrou && !!anterior
      && anterior.autor_id === m.autor_id
      && anterior.tipo === "texto" && m.tipo === "texto"
      && new Date(m.created_at).getTime() - new Date(anterior.created_at).getTime() < JANELA_AGRUPAR_MS;
    itens.push({ tipo: "msg", chave: m.id, msg: m, continuacao });
    anterior = m;
  }
  return itens;
}

/**
 * Menções pelo texto final: "@Nome Completo" de quem é do tenant, e
 * "@todos"/"@canal" para todo mundo. Nome mais longo primeiro, para
 * "@Ana Paula" não virar "@Ana".
 */
export function extrairMencoes(texto: string, pessoas: Pessoa[]): { ids: string[]; todos: boolean } {
  const ids = new Set<string>();
  let resto = texto;
  const ordenadas = [...pessoas].sort((a, b) => b.nome.length - a.nome.length);
  for (const p of ordenadas) {
    const alvo = `@${p.nome}`;
    const idx = resto.toLocaleLowerCase("pt-BR").indexOf(alvo.toLocaleLowerCase("pt-BR"));
    if (idx >= 0) {
      ids.add(p.user_id);
      resto = resto.slice(0, idx) + " ".repeat(alvo.length) + resto.slice(idx + alvo.length);
    }
  }
  const todos = /(^|\s)@(todos|canal)\b/i.test(texto);
  return { ids: [...ids], todos };
}

/** Páginas do useInfiniteQuery: cada página em ordem DECRESCENTE de data. */
export type PaginasMsgs = { pages: Mensagem[][]; pageParams: unknown[] };

/**
 * Coloca (ou atualiza) uma mensagem no cache paginado. Chega pelo Realtime,
 * pela resposta da RPC ou pelo envio otimista; o que vier primeiro entra, o
 * resto atualiza. Mensagem otimista some quando a real chega (`substitui`).
 */
export function mesclarMensagem(dados: PaginasMsgs | undefined, msg: Mensagem, substitui?: string): PaginasMsgs | undefined {
  if (!dados) return dados;
  let achou = false;
  const pages = dados.pages.map((pg) => {
    let out = pg;
    if (substitui) out = out.filter((m) => m.id !== substitui);
    return out.map((m) => {
      if (m.id === msg.id) { achou = true; return { ...m, ...msg, _pendente: false, _falhou: false }; }
      return m;
    });
  });
  if (!achou) {
    const primeira = [msg, ...(pages[0] ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
    pages[0] = primeira;
  }
  return { ...dados, pages };
}

export function atualizarMensagem(
  dados: PaginasMsgs | undefined, id: string, fn: (m: Mensagem) => Mensagem,
): PaginasMsgs | undefined {
  if (!dados) return dados;
  return { ...dados, pages: dados.pages.map((pg) => pg.map((m) => (m.id === id ? fn(m) : m))) };
}

/** Liga/desliga a minha reação localmente (antes da confirmação do banco). */
export function alternarReacao(reacoes: Record<string, string[]>, emoji: string, eu: string): Record<string, string[]> {
  const atual = reacoes[emoji] ?? [];
  const lista = atual.includes(eu) ? atual.filter((u) => u !== eu) : [...atual, eu];
  const out = { ...reacoes };
  if (lista.length === 0) delete out[emoji]; else out[emoji] = lista;
  return out;
}

/** Prévia da lista, igual à que o banco monta em equipe_minhas_conversas. */
export function previaDe(m: Pick<Mensagem, "corpo" | "anexos" | "refs" | "apagada_em">): string {
  if (m.apagada_em) return "Mensagem apagada";
  if (m.corpo) return m.corpo.replace(/\s+/g, " ").slice(0, 140);
  const a = m.anexos?.[0];
  if (a) return a.mime?.startsWith("image/") ? "Enviou uma imagem" : `Enviou ${a.nome}`;
  const r = m.refs?.[0];
  if (r) return r.tipo === "ticket" ? "Compartilhou um ticket" : r.tipo === "cliente" ? "Compartilhou um cliente" : "Pediu ajuda com um atendimento";
  return "";
}
