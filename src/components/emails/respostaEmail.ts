/**
 * Regras de responder, responder a todos e encaminhar (entrega 3, 15/09/2026).
 *
 * Tudo aqui é função pura, com teste: é onde mora o risco de mandar e-mail para
 * a pessoa errada (responder a todos que devolve para a própria conta, ou
 * "Re: Re: Re:" empilhando no assunto).
 */

export type ModoEscrita = "responder" | "responder_todos" | "encaminhar";

const PREFIXO_RESPOSTA = /^\s*(re|res|res\.|enc|fwd|fw|em)\s*:\s*/i;
/** o código que a send-email põe no fim do assunto não se repete na resposta */
const MARCA_TOKEN = /\s*\[#[A-HJ-NP-Z2-9]{10}\]\s*$/i;

export const limparAssunto = (assunto: string) =>
  (assunto || "").replace(MARCA_TOKEN, "").replace(PREFIXO_RESPOSTA, "").trim();

/** "Re: assunto" e "Enc: assunto", sem empilhar prefixo */
export function assuntoDaEscrita(modo: ModoEscrita, assuntoOriginal: string | null): string {
  const base = limparAssunto(assuntoOriginal ?? "") || "(sem assunto)";
  return `${modo === "encaminhar" ? "Enc" : "Re"}: ${base}`;
}

const normalizar = (e: string) => e.trim().toLowerCase();

/**
 * Quem recebe a resposta.
 *
 * Responder: só quem escreveu. Responder a todos: mais os outros destinatários,
 * sem repetir e SEM as contas da própria operação — senão a resposta volta para
 * a caixa que a enviou e vira e-mail fantasma no Recebidos.
 */
export function destinatariosDaResposta(params: {
  modo: ModoEscrita;
  de: string | null;
  para: string[];
  cc?: string[];
  /** e-mails das contas do tenant, que nunca entram na resposta */
  contasDaCasa: string[];
}): { para: string[]; cc: string[] } {
  if (params.modo === "encaminhar") return { para: [], cc: [] };

  const daCasa = new Set(params.contasDaCasa.map(normalizar));
  const de = params.de ? normalizar(params.de) : "";
  const principal = de && !daCasa.has(de) ? [de] : [];

  if (params.modo === "responder") return { para: principal, cc: [] };

  const vistos = new Set<string>([...principal, ...daCasa]);
  const cc: string[] = [];
  for (const e of [...(params.para ?? []), ...(params.cc ?? [])]) {
    const limpo = normalizar(e);
    if (!limpo || vistos.has(limpo)) continue;
    vistos.add(limpo);
    cc.push(limpo);
  }
  return { para: principal, cc };
}

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const dataLegivel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })
    : "";

/**
 * O e-mail original citado embaixo da resposta, como todo programa de e-mail
 * faz: uma linha dizendo quem escreveu e quando, e o texto recuado.
 */
export function citacaoDoOriginal(original: {
  de: string | null;
  quando: string | null;
  assunto: string | null;
  corpoHtml?: string | null;
  corpoTexto?: string | null;
}): string {
  const cabecalho = `Em ${dataLegivel(original.quando)}, ${escapar(original.de ?? "o cliente")} escreveu:`;
  const corpo = original.corpoHtml
    ? original.corpoHtml
    : `<p style="margin:0">${escapar(original.corpoTexto ?? "")
        .split(/\r?\n/)
        .join("<br>")}</p>`;

  return [
    "<p></p>",
    `<p>${cabecalho}</p>`,
    `<blockquote>${corpo}</blockquote>`,
  ].join("");
}

/** o corpo com que a tela abre: espaço para escrever em cima da citação */
export function corpoInicial(modo: ModoEscrita, original: Parameters<typeof citacaoDoOriginal>[0]): string {
  const abertura = modo === "encaminhar" ? "<p></p><p>Segue abaixo o e-mail.</p>" : "<p></p>";
  return `${abertura}${citacaoDoOriginal(original)}`;
}

export const ROTULO_MODO: Record<ModoEscrita, string> = {
  responder: "Responder",
  responder_todos: "Responder a todos",
  encaminhar: "Encaminhar",
};

/** origem gravada em email_envios: a tela E-mails mostra e filtra por ela */
export const ORIGEM_DO_MODO: Record<ModoEscrita, string> = {
  responder: "resposta",
  responder_todos: "resposta",
  encaminhar: "encaminho",
};
