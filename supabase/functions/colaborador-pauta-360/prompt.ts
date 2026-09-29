// Prompt e leitura da resposta da pauta de 1:1 do Théo. Puro (sem Deno), para
// o vitest do frontend testar junto.

export interface Metrica {
  valor: number | null;
  time: number | null;
  posicao: number | null;
}

export interface ContextoPauta {
  nome: string;
  cargo: string | null;
  setor: string | null;
  periodo: { de: string; ate: string };
  grupo: "setor" | "tenant";
  pessoasNoGrupo: number | null;
  encerrados: Metrica;
  csat: Metrica & { notas: number };
  primeiraRespostaSeg: Metrica;
  tmaSeg: Metrica;
  resolvidoPrimeiroContatoPct: Metrica;
  reaberturaPct: number | null;
  ticketsResolvidos: number;
  ticketsAbertos: number;
  ticketMaisAntigoDias: number | null;
  assuntos: { nome: string; n: number; csat: number | null; notas: number }[];
  comentarios: { nota: number; texto: string }[];
  jornada: { diasComExpediente: number; pausaMin: number; acimaDoPrevistoMin: number; motivoMaisAcima: string | null } | null;
}

const d = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const corta = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const tempo = (s: number | null) => (s == null ? "sem dado" : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s)} s`);

function linhaMetrica(rotulo: string, m: Metrica, fmt: (v: number | null) => string, total: number | null, menorMelhor = false) {
  const partes = [`${rotulo}: ${fmt(m.valor)}`];
  if (m.time != null) partes.push(`média do grupo ${fmt(m.time)}`);
  if (m.posicao != null && total) partes.push(`posição ${m.posicao} de ${total}${menorMelhor ? " (1 = mais rápido)" : ""}`);
  return `- ${partes.join(" | ")}`;
}

export function montarPrompt(c: ContextoPauta): { system: string; user: string } {
  const n = c.pessoasNoGrupo;
  const L: string[] = [];
  L.push(`COLABORADOR: ${c.nome}${c.cargo ? `, ${c.cargo}` : ""}${c.setor ? `, setor ${c.setor}` : ""}`);
  L.push(`PERÍODO: ${d(c.periodo.de)} a ${d(c.periodo.ate)}`);
  L.push(`COMPARADO COM: ${c.grupo === "setor" ? `o setor (${n ?? "?"} pessoas)` : `a empresa toda (${n ?? "?"} pessoas; o setor tem menos de 3)`}`);
  L.push("", "NÚMEROS:");
  L.push(linhaMetrica("Atendimentos encerrados", c.encerrados, (v) => (v == null ? "sem dado" : String(Math.round(v))), n));
  L.push(linhaMetrica(`CSAT (${c.csat.notas} notas)`, c.csat, (v) => (v == null ? "sem nota" : `${v.toFixed(1)}/5`), n));
  L.push(linhaMetrica("1ª resposta (mediana)", c.primeiraRespostaSeg, tempo, n, true));
  L.push(linhaMetrica("Tempo médio de atendimento (mediana)", c.tmaSeg, tempo, n, true));
  L.push(linhaMetrica("Resolvido no 1º contato", c.resolvidoPrimeiroContatoPct, (v) => (v == null ? "sem dado (IA analisou pouco)" : `${Math.round(v)}%`), n));
  if (c.reaberturaPct != null) L.push(`- Reabertos: ${c.reaberturaPct}%`);
  L.push(`- Tickets: ${c.ticketsResolvidos} resolvidos no período, ${c.ticketsAbertos} abertos agora${c.ticketMaisAntigoDias != null ? `, o mais antigo há ${c.ticketMaisAntigoDias} dias` : ""}`);

  L.push("", "ASSUNTOS MAIS ATENDIDOS:");
  for (const a of c.assuntos) L.push(`- ${a.nome}: ${a.n} atendimentos${a.csat != null && a.notas >= 3 ? `, CSAT ${a.csat.toFixed(1)} em ${a.notas} notas` : ""}`);
  if (!c.assuntos.length) L.push("- nenhum");

  L.push("", "COMENTÁRIOS DE CLIENTES (do mais recente):");
  for (const k of c.comentarios) L.push(`- nota ${k.nota}/5: "${corta(k.texto, 140)}"`);
  if (!c.comentarios.length) L.push("- nenhum");

  if (c.jornada) {
    L.push("", "JORNADA (registro do botão de expediente, não é ponto):");
    L.push(`- ${c.jornada.diasComExpediente} dias com expediente, ${c.jornada.pausaMin} min em pausa`);
    L.push(`- ${c.jornada.acimaDoPrevistoMin} min de pausa acima do previsto${c.jornada.motivoMaisAcima ? `, a maior parte em ${c.jornada.motivoMaisAcima}` : ""}`);
  }

  const system = [
    "Você é o Théo, assistente de uma empresa de software que atende clientes por assinatura.",
    "Um gestor vai ter uma conversa individual (1:1) com uma pessoa do time. Prepare a pauta a partir dos números e comentários abaixo.",
    "Escreva em português do Brasil, frases curtas, tom respeitoso e construtivo, sem jargão e sem inventar nada que não esteja nos dados.",
    "Não use travessão. Não julgue a pessoa: fale de fatos e comportamentos. Pausa acima do previsto é assunto para conversar, nunca acusação.",
    'Responda SOMENTE um JSON: {"resumo": "...", "reconhecer": ["..."], "conversar": ["..."], "desenvolver": ["..."]}.',
    '"resumo": 2 ou 3 frases sobre o momento da pessoa no período.',
    '"reconhecer": de 1 a 3 conquistas concretas, com o número que as sustenta.',
    '"conversar": de 0 a 3 pontos de atenção para abordar, cada um com o dado que o motiva.',
    '"desenvolver": de 0 a 2 sugestões práticas de desenvolvimento ligadas aos pontos de atenção.',
    "Cada item com até 25 palavras. Lista vazia quando não houver dado que sustente.",
  ].join("\n");

  return { system, user: L.join("\n") };
}

export interface Pauta {
  resumo: string;
  reconhecer: string[];
  conversar: string[];
  desenvolver: string[];
}

/** Aceita o JSON puro ou cercado de ```; devolve null se não der para ler. */
export function lerResposta(txt: string): Pauta | null {
  const bruto = txt.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ini = bruto.indexOf("{"), fim = bruto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    const o = JSON.parse(bruto.slice(ini, fim + 1));
    const resumo = typeof o?.resumo === "string" ? o.resumo.trim() : "";
    if (!resumo) return null;
    const lista = (v: unknown, max: number) =>
      (Array.isArray(v) ? v : []).filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).trim()).slice(0, max);
    return { resumo, reconhecer: lista(o.reconhecer, 3), conversar: lista(o.conversar, 3), desenvolver: lista(o.desenvolver, 2) };
  } catch {
    return null;
  }
}

/** Modelo de raciocínio gasta o teto pensando: dá folga só para eles. */
export function maxTokensFor(model: string): number {
  const m = (model ?? "").toLowerCase();
  const raciocina = m.includes("gpt-5") || /(^|[/-])o[134](-|$)/.test(m);
  return raciocina ? 16_000 : 1500;
}
