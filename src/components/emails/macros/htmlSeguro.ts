import { cn } from "@/lib/utils";

/**
 * A prévia da macro desenha HTML guardado no banco com dangerouslySetInnerHTML.
 * O editor só produz tags inofensivas, mas o banco aceita o que vier; então a
 * prévia passa por aqui antes: fica só o que o editor sabe fazer, e o resto
 * vira texto ou some (script, iframe, evento onclick, javascript: no link).
 *
 * Quando o texto vai para o editor (Usar esta macro) quem limpa é o próprio
 * TipTap, que descarta o que não conhece.
 */

const PERMITIDAS = new Set([
  "P", "BR", "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "UL", "OL", "LI", "A", "SPAN", "BLOCKQUOTE", "DIV",
]);
// somem com o conteúdo junto; qualquer outra tag desconhecida vira só o texto dela
const DESCARTAR = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "TEMPLATE", "NOSCRIPT", "LINK", "META"]);
const ESTILOS = /^(color|font-family|font-size|text-align)\s*:\s*[^;"<>()]*(\([^)<>"]*\))?[^;"<>()]*$/i;

function limparEstilo(estilo: string): string {
  return estilo
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && ESTILOS.test(d) && !/url\s*\(|expression/i.test(d))
    .join("; ");
}

function linkSeguro(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href.trim());
}

function limpar(no: Node, doc: Document): Node | null {
  if (no.nodeType === Node.TEXT_NODE) return doc.createTextNode(no.textContent ?? "");
  if (no.nodeType !== Node.ELEMENT_NODE) return null;
  const el = no as Element;
  const tag = el.tagName.toUpperCase();
  if (DESCARTAR.has(tag)) return null;

  const filhos = Array.from(el.childNodes)
    .map((f) => limpar(f, doc))
    .filter((f): f is Node => !!f);

  if (!PERMITIDAS.has(tag)) {
    const pedaco = doc.createDocumentFragment();
    filhos.forEach((f) => pedaco.appendChild(f));
    return pedaco;
  }

  const novo = doc.createElement(tag.toLowerCase());
  const estilo = limparEstilo(el.getAttribute("style") ?? "");
  if (estilo) novo.setAttribute("style", estilo);
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    if (linkSeguro(href)) {
      novo.setAttribute("href", href.trim());
      novo.setAttribute("target", "_blank");
      novo.setAttribute("rel", "noopener noreferrer");
    }
  }
  filhos.forEach((f) => novo.appendChild(f));
  return novo;
}

export function htmlSeguro(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html ?? ""}</body>`, "text/html");
  const saida = doc.createElement("div");
  Array.from(doc.body.childNodes).forEach((n) => {
    const limpo = limpar(n, doc);
    if (limpo) saida.appendChild(limpo);
  });
  return saida.innerHTML;
}

/** o corpo da prévia desenhado como no editor */
export const CORPO_PREVIA =
  "[&_p]:my-0 [&_p+p]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-sky-600 [&_a]:underline";

/** verde: preenchido; amarelo tracejado: falta (marcas do preencher com marcar) */
export const MARCAS_PREVIA = cn(
  "[&_mark]:rounded [&_mark]:px-0.5 [&_mark]:font-semibold",
  "[&_mark[data-campo=ok]]:bg-emerald-500/15 [&_mark[data-campo=ok]]:text-emerald-700 dark:[&_mark[data-campo=ok]]:text-emerald-300",
  "[&_mark[data-campo=falta]]:border [&_mark[data-campo=falta]]:border-dashed [&_mark[data-campo=falta]]:border-amber-500 [&_mark[data-campo=falta]]:bg-amber-500/10 [&_mark[data-campo=falta]]:text-amber-700 dark:[&_mark[data-campo=falta]]:text-amber-300",
);
