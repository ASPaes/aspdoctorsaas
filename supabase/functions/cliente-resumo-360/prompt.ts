// Prompt e leitura da resposta do resumo do Théo. Puro (sem Deno), para o
// vitest do frontend testar junto.

export interface Contexto {
  nome: string;
  cancelado: boolean;
  clienteDesde: string | null;
  certA1: string | null;
  mrrHoje: number;
  mrr12m: number;
  atendimentos: {
    codigo: string | null; data: string; status: string; resolucao: string | null;
    assunto: string | null; resumo: string | null; nota: number | null; comentario: string | null;
  }[];
  tickets: { codigo: string | null; assunto: string; aberto: string; concluido: string | null; status: string | null; encerrado: boolean }[];
  titulosAbertos: { vencimento: string; valor: number; situacao: string; diasAtraso: number }[];
}

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const data = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "?");
const corta = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function montarPrompt(c: Contexto): { system: string; user: string } {
  const linhas: string[] = [];
  linhas.push(`CLIENTE: ${c.nome}${c.cancelado ? " (CANCELADO)" : ""}`);
  if (c.clienteDesde) linhas.push(`Cliente desde: ${data(c.clienteDesde)}`);
  linhas.push(`MRR hoje: ${brl(c.mrrHoje)} · há 12 meses: ${brl(c.mrr12m)}`);
  if (c.certA1) linhas.push(`Certificado A1 vence em: ${data(c.certA1)}`);

  linhas.push("", `ATENDIMENTOS DOS ÚLTIMOS 90 DIAS (${c.atendimentos.length}, do mais recente):`);
  for (const a of c.atendimentos) {
    const partes = [
      data(a.data), a.codigo, a.assunto, a.status !== "closed" ? "EM ABERTO" : a.resolucao,
      a.nota != null ? `nota ${a.nota}/5` : null, a.comentario ? `comentário: "${corta(a.comentario, 120)}"` : null,
    ].filter(Boolean);
    linhas.push(`- ${partes.join(" | ")}${a.resumo ? ` :: ${corta(a.resumo, 220)}` : ""}`);
  }
  if (!c.atendimentos.length) linhas.push("- nenhum");

  const abertos = c.tickets.filter((t) => !t.encerrado);
  linhas.push("", `TICKETS ABERTOS (${abertos.length}):`);
  for (const t of abertos) linhas.push(`- ${t.codigo ?? "?"} | aberto ${data(t.aberto)} | ${t.status ?? "?"} | ${corta(t.assunto, 140)}`);
  if (!abertos.length) linhas.push("- nenhum");
  const fechados = c.tickets.filter((t) => t.encerrado).slice(0, 5);
  if (fechados.length) {
    linhas.push("", "ÚLTIMOS TICKETS ENCERRADOS:");
    for (const t of fechados) linhas.push(`- ${t.codigo ?? "?"} | ${data(t.aberto)} a ${data(t.concluido)} | ${corta(t.assunto, 140)}`);
  }

  if (c.titulosAbertos.length) {
    linhas.push("", "TÍTULOS A RECEBER EM ABERTO:");
    for (const t of c.titulosAbertos) {
      linhas.push(`- vence ${data(t.vencimento)} | ${brl(t.valor)} | ${t.situacao === "atrasado" ? `VENCIDO há ${t.diasAtraso} dias` : t.situacao}`);
    }
  }

  const system = [
    "Você é o Théo, assistente de uma empresa de software que atende clientes por assinatura.",
    "Seu trabalho é ler o histórico de UM cliente e contar a quem vai falar com ele como a relação está.",
    "Escreva em português do Brasil, frases curtas, sem jargão técnico e sem inventar nada que não esteja nos dados.",
    "Não use travessão.",
    'Responda SOMENTE um JSON: {"resumo": "...", "pontos": ["...", "..."]}.',
    '"resumo": de 2 a 4 frases sobre o momento do cliente (satisfação, problemas recorrentes, financeiro, receita).',
    '"pontos": de 0 a 3 próximos passos concretos para quem vai atender, cada um com até 20 palavras. Lista vazia se não houver nada a fazer.',
  ].join("\n");

  return { system, user: linhas.join("\n") };
}

/** Aceita o JSON puro ou cercado de ```; devolve null se não der para ler. */
export function lerResposta(txt: string): { resumo: string; pontos: string[] } | null {
  const bruto = txt.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const ini = bruto.indexOf("{"), fim = bruto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    const o = JSON.parse(bruto.slice(ini, fim + 1));
    const resumo = typeof o?.resumo === "string" ? o.resumo.trim() : "";
    if (!resumo) return null;
    const pontos = Array.isArray(o?.pontos)
      ? o.pontos.filter((p: unknown) => typeof p === "string" && p.trim()).map((p: string) => p.trim()).slice(0, 3)
      : [];
    return { resumo, pontos };
  } catch {
    return null;
  }
}
