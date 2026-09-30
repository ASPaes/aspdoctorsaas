/**
 * Imagem colada no corpo do e-mail (29/09/2026).
 *
 * No editor a imagem aparece pelo endereço local do navegador (`blob:`) e
 * guarda em `data-caminho` onde ela ficou no Storage depois de subir. No envio,
 * cada uma vira `cid:ds-img-N` e a send-email embute o arquivo no e-mail, como
 * faz com a imagem da assinatura. O formato do cid é o que a send-email confere
 * (`validarImagensColadas`): mudou um, mude o outro.
 */
export const TIPOS_IMAGEM_COLADA = ["image/png", "image/jpeg", "image/gif", "image/webp"];

const MIME_DA_EXTENSAO: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export interface ImagemParaEnvio {
  path: string;
  mime: string;
  cid: string;
}

const atributo = (tag: string, nome: string) => {
  const m = tag.match(new RegExp(`\\s${nome}="([^"]*)"`, "i"));
  return m ? m[1] : null;
};

export function prepararImagensColadas(html: string): {
  html: string;
  imagens: ImagemParaEnvio[];
  /** ainda subindo (ou falharam): o envio espera */
  pendentes: number;
} {
  const imagens: ImagemParaEnvio[] = [];
  let pendentes = 0;

  const saida = (html || "").replace(/<img\b[^>]*>/gi, (tag) => {
    const caminho = atributo(tag, "data-caminho");
    if (caminho) {
      const mime = MIME_DA_EXTENSAO[(caminho.split(".").pop() ?? "").toLowerCase()];
      if (mime) {
        const cid = `ds-img-${imagens.length + 1}`;
        imagens.push({ path: caminho, mime, cid });
        return `<img src="cid:${cid}" alt="" style="max-width:100%;height:auto">`;
      }
    }
    const src = atributo(tag, "src") ?? "";
    // endereço do navegador sem caminho no Storage: ainda subindo
    if (src.startsWith("blob:")) {
      pendentes += 1;
      return tag;
    }
    // imagem de fora que veio num texto colado continua como link
    return /^https:\/\//i.test(src) ? tag : "";
  });

  return { html: saida, imagens, pendentes };
}
