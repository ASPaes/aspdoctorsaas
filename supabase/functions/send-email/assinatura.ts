/**
 * Assinatura da conta, montada para ir no fim do e-mail.
 *
 * Vem de `email_account_assinaturas`: texto, imagem ou os dois (a imagem fica
 * embaixo do texto). A imagem vai EMBUTIDA, referenciada por Content-ID, e não
 * como link: o Outlook bloqueia imagem de fora até a pessoa clicar em "baixar
 * imagens", e a embutida aparece direto.
 */

export interface AssinaturaSalva {
  texto: string | null;
  imagem_base64: string | null;
  imagem_mime: string | null;
  imagem_largura: number | null;
  imagem_altura: number | null;
}

export interface Embutida {
  cid: string;
  mime: string;
  nome: string;
  base64: string;
}

export interface AssinaturaMontada {
  html: string;
  texto: string;
  embutidas: Embutida[];
}

export const CID_ASSINATURA = "assinatura@doctorsaas";

/** só o que todo leitor de e-mail mostra; SVG, por exemplo, o Gmail não exibe */
const EXTENSAO: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };

/** largura útil de um e-mail; a tela já grava no máximo isso */
const LARGURA_MAXIMA = 600;

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const COR_LINK = "#0EA5E9";

/** endereço de site e de e-mail viram link; o resto fica como a pessoa digitou */
function comLinks(linhaEscapada: string): string {
  return linhaEscapada
    .replace(/\b(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g, `<a href="$1" style="color:${COR_LINK}">$1</a>`)
    .replace(/(^|[\s(])(www\.[^\s<]*[^\s<.,;:!?)])/g, `$1<a href="https://$2" style="color:${COR_LINK}">$2</a>`)
    .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, `<a href="mailto:$1" style="color:${COR_LINK}">$1</a>`);
}

export function montarAssinatura(a: AssinaturaSalva | null | undefined): AssinaturaMontada | null {
  if (!a) return null;

  const texto = (a.texto ?? "").replace(/\r\n/g, "\n").trim();
  const mime = a.imagem_mime ?? "";
  const base64 = (a.imagem_base64 ?? "").replace(/\s+/g, "");
  const temImagem = !!base64 && !!EXTENSAO[mime] && /^[A-Za-z0-9+/]+=*$/.test(base64);
  if (!texto && !temImagem) return null;

  const partes: string[] = [];
  if (texto) {
    partes.push(`<div>${texto.split("\n").map((l) => comLinks(escapar(l))).join("<br>")}</div>`);
  }
  if (temImagem) {
    const w = Number(a.imagem_largura) || 0;
    const h = Number(a.imagem_altura) || 0;
    const largura = w > 0 ? Math.min(w, LARGURA_MAXIMA) : 0;
    const altura = largura && h > 0 ? Math.max(1, Math.round((h * largura) / w)) : 0;
    // largura e altura explícitas: é o que o Outlook respeita
    const medidas = largura ? ` width="${largura}"${altura ? ` height="${altura}"` : ""}` : "";
    partes.push(
      `<div style="margin-top:${texto ? 10 : 0}px"><img src="cid:${CID_ASSINATURA}" alt=""${medidas} style="display:block;border:0;max-width:100%;height:auto"></div>`,
    );
  }

  return {
    html: `<div style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#334155">${partes.join("")}</div>`,
    // "-- " (com o espaço) é o separador de assinatura do texto puro (RFC 3676)
    texto: texto ? `-- \n${texto}` : "",
    embutidas: temImagem ? [{ cid: CID_ASSINATURA, mime, nome: `assinatura.${EXTENSAO[mime]}`, base64 }] : [],
  };
}

function inserirNoFim(html: string, trecho: string): string {
  const i = html.toLowerCase().lastIndexOf("</body>");
  return i >= 0 ? html.slice(0, i) + trecho + html.slice(i) : html + trecho;
}

/** junta a assinatura ao corpo que veio de quem pediu o envio */
export function aplicarAssinatura(
  corpo: { html: string | null; texto: string | null },
  assinatura: AssinaturaMontada | null,
): { html: string | null; texto: string | null; embutidas: Embutida[] } {
  if (!assinatura) return { ...corpo, embutidas: [] };

  // imagem só aparece em HTML: corpo que veio só em texto ganha uma versão HTML simples
  const htmlBase = corpo.html ??
    (assinatura.embutidas.length && corpo.texto
      ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1E293B">${
        corpo.texto.replace(/\r\n/g, "\n").split("\n").map(escapar).join("<br>")
      }</div>`
      : null);

  return {
    html: htmlBase ? inserirNoFim(htmlBase, assinatura.html) : null,
    // sem texto próprio, o texto puro sai do HTML (que já leva a assinatura)
    texto: corpo.texto && assinatura.texto ? `${corpo.texto.replace(/\s+$/, "")}\n\n${assinatura.texto}` : corpo.texto,
    embutidas: htmlBase ? assinatura.embutidas : [],
  };
}
