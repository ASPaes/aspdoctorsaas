/**
 * Regras puras da tela "Enviar e-mail" do chat.
 *
 * Trava do Enviar (decisão do Alexandre, 14/09/2026): o corpo na tela foi gerado
 * com um conjunto de opções (atendimento, quantidade, tom). Se as opções atuais
 * diferem da ÚLTIMA geração, o Enviar trava até clicar em Gerar novo. Voltar às
 * opções da última geração sem gerar libera de novo, porque o texto na tela já
 * corresponde a elas. Exemplo dele: gerou em Amigável, trocou para Técnico sem
 * gerar (trava), voltou para Amigável (libera).
 */

export type BaseAtendimento = "ultimo" | "resumo";
export type TomEmail = "formal" | "amigavel" | "tecnico" | "profissional";

export interface OpcoesGeracao {
  base: BaseAtendimento;
  /** só vale quando base = "resumo"; com "ultimo" é sempre 1 atendimento */
  quantidade: number;
  tom: TomEmail;
}

export const OPCOES_PADRAO: OpcoesGeracao = { base: "ultimo", quantidade: 1, tom: "formal" };

export const QUANTIDADE_MAXIMA = 10;

export const TONS: { valor: TomEmail; rotulo: string }[] = [
  { valor: "formal", rotulo: "Formal" },
  { valor: "amigavel", rotulo: "Amigável" },
  { valor: "tecnico", rotulo: "Técnico" },
  { valor: "profissional", rotulo: "Profissional" },
];

export interface EstadoTrava {
  travado: boolean;
  aviso: string | null;
}

export function conferirTrava(atual: OpcoesGeracao, gerado: OpcoesGeracao): EstadoTrava {
  const mudouBase = atual.base !== gerado.base;
  // com "ultimo" dos dois lados a quantidade não entra na geração, então não conta
  const mudouQuantidade = !mudouBase && atual.base === "resumo" && atual.quantidade !== gerado.quantidade;
  const mudouTom = atual.tom !== gerado.tom;

  if (!mudouBase && !mudouQuantidade && !mudouTom) return { travado: false, aviso: null };

  let oQue: string;
  if (mudouBase) oQue = mudouTom ? "o atendimento e o tom do e-mail" : "o atendimento usado no e-mail";
  else if (mudouQuantidade) oQue = mudouTom ? "a quantidade de atendimentos e o tom do e-mail" : "a quantidade de atendimentos";
  else oQue = "o tom do e-mail";

  return { travado: true, aviso: `Você trocou ${oQue}. Clique em Gerar novo antes de enviar.` };
}

export function normalizarQuantidade(valor: number): number {
  if (!Number.isFinite(valor)) return 1;
  return Math.max(1, Math.min(QUANTIDADE_MAXIMA, Math.trunc(valor)));
}

const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;

export const emailValido = (s: string) => EMAIL.test(s.trim());

export const MAX_ASSUNTO = 300;

/**
 * Referência legível no assunto (decisão do Alexandre, 14/09/2026): o número do
 * ticket quando o atendimento tem um, senão o do atendimento. Não substitui o
 * código `[#XXXXXXXXXX]` que a send-email põe no fim: é por aquele que a
 * resposta do cliente é encontrada.
 */
export function referenciaDoAssunto(ticketCodigo: string | null | undefined, atendimentoCodigo: string | null | undefined): string | null {
  if (ticketCodigo) return `Ticket ${ticketCodigo}`;
  if (atendimentoCodigo) return `Atendimento #${atendimentoCodigo}`;
  return null;
}

/** acrescenta a referência uma vez só, cortando o assunto se passar do limite do servidor */
export function assuntoComReferencia(assunto: string, referencia: string | null): string {
  const base = assunto.trim();
  if (!referencia || base.toLowerCase().includes(referencia.toLowerCase())) return base.slice(0, MAX_ASSUNTO);
  const sufixo = ` · ${referencia}`;
  return `${base.slice(0, MAX_ASSUNTO - sufixo.length).trimEnd()}${sufixo}`;
}

const escaparHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ITEM_DE_LISTA = /^\s*[•\-*]\s+(.*)$/;

/**
 * Texto da IA (texto simples) vira o HTML que o editor entende: linha em branco
 * separa parágrafo, quebra simples vira <br>, e linhas seguidas começando com
 * "• " (ou "- ") viram lista. Tudo escapado: o que veio da IA nunca vira marcação.
 */
export function textoParaParagrafos(texto: string): string {
  const blocos = (texto || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocos
    .map((bloco) => {
      const partes: string[] = [];
      let linhas: string[] = [];
      let itens: string[] = [];
      const fecharLinhas = () => {
        if (linhas.length) partes.push(`<p>${linhas.map(escaparHtml).join("<br>")}</p>`);
        linhas = [];
      };
      const fecharItens = () => {
        if (itens.length) partes.push(`<ul>${itens.map((i) => `<li><p>${escaparHtml(i)}</p></li>`).join("")}</ul>`);
        itens = [];
      };
      for (const linha of bloco.split("\n")) {
        const item = ITEM_DE_LISTA.exec(linha);
        if (item) {
          fecharLinhas();
          itens.push(item[1].trim());
        } else {
          fecharItens();
          linhas.push(linha.trim());
        }
      }
      fecharLinhas();
      fecharItens();
      return partes.join("");
    })
    .join("");
}

/**
 * HTML do editor pronto para cliente de e-mail: margens inline (Outlook e Gmail
 * ignoram CSS de fora), parágrafo vazio com <br> para não sumir, e a fonte
 * padrão no contêiner. Fonte, tamanho, cor e alinhamento já saem inline do editor.
 */
export function htmlParaEmail(htmlEditor: string): string {
  const corpo = (htmlEditor || "")
    .replace(/<p><\/p>/g, "<p><br></p>")
    .replace(/<p(?:\s+style="([^"]*)")?>/g, (_m, estilo?: string) => `<p style="margin:0 0 12px;${estilo ?? ""}">`)
    .replace(/<li><p style="margin:0 0 12px;/g, '<li><p style="margin:0;')
    .replace(/<ul>/g, '<ul style="margin:0 0 12px;padding-left:22px">')
    .replace(/<ol>/g, '<ol style="margin:0 0 12px;padding-left:22px">')
    .replace(/<blockquote>/g, '<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #CBD5E1;color:#475569">');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1E293B">${corpo}</div>`;
}

/**
 * Anexo do e-mail. Espelha `supabase/functions/send-email/anexos.ts`, que
 * confere de novo no servidor: mudou um, mude o outro.
 */
export const ANEXO_MAX_ARQUIVOS = 10;
/** somados: em base64 o e-mail cresce ~37%, e 18 MB viram ~25 MB, o teto de Gmail e Outlook */
export const ANEXO_MAX_TOTAL_BYTES = 18 * 1024 * 1024;

const ANEXO_TIPOS = new Set([
  "application/pdf",
  "application/xml",
  "text/xml",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const ANEXO_PREFIXOS = ["image/", "video/", "audio/"];
const ANEXO_EXTENSOES = [
  "pdf", "xml", "csv", "txt", "zip", "doc", "docx", "xls", "xlsx", "odt", "ods",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "mp4", "mov", "mp3", "ogg", "wav", "m4a",
];

/** `accept` do seletor de arquivo: filtra a janela, a regra de verdade é anexoPermitido */
export const ANEXO_ACCEPT = [...ANEXO_EXTENSOES.map((e) => `.${e}`), "image/*", "video/*", "audio/*"].join(",");

export function anexoPermitido(mime: string, nome: string): boolean {
  const tipo = (mime || "").toLowerCase().split(";")[0].trim();
  if (tipo === "image/svg+xml" || /\.svg$/i.test(nome)) return false;
  if (ANEXO_TIPOS.has(tipo) || ANEXO_PREFIXOS.some((p) => tipo.startsWith(p))) return true;
  if (!tipo || tipo === "application/octet-stream") {
    return ANEXO_EXTENSOES.includes((nome.split(".").pop() || "").toLowerCase());
  }
  return false;
}

export type TipoVisualizacao = "imagem" | "pdf" | "video" | "audio";

/**
 * O que abre no olhinho antes de enviar. HEIC e TIFF são imagem, mas o Chrome
 * não desenha: ficam só com Baixar, em vez de abrir uma prévia quebrada.
 * Tipo vazio (navegador que não informa) decide pela extensão.
 */
export function tipoParaVisualizar(mime: string, nome: string): TipoVisualizacao | null {
  const tipo = (mime || "").toLowerCase().split(";")[0].trim();
  const ext = (nome.split(".").pop() || "").toLowerCase();
  if (/^image\/(heic|heif|tiff)$/.test(tipo) || ["heic", "heif", "tif", "tiff"].includes(ext)) return null;
  if (tipo === "image/svg+xml") return null;
  if (tipo.startsWith("image/") || (!tipo && ["jpg", "jpeg", "png", "gif", "webp"].includes(ext))) return "imagem";
  if (tipo === "application/pdf" || (!tipo && ext === "pdf")) return "pdf";
  if (tipo.startsWith("video/") || (!tipo && ["mp4", "mov", "webm"].includes(ext))) return "video";
  if (tipo.startsWith("audio/") || (!tipo && ["mp3", "ogg", "wav", "m4a"].includes(ext))) return "audio";
  return null;
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = (bytes / (1024 * 1024)).toFixed(1).replace(".", ",");
  return `${mb.endsWith(",0") ? mb.slice(0, -2) : mb} MB`;
}

/** endereço digitado no botão de link: completa o protocolo; e-mail vira mailto */
export function normalizarUrl(bruto: string): string {
  const u = (bruto || "").trim();
  if (!u) return "";
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(u)) return `mailto:${u}`;
  return `https://${u.replace(/^\/+/, "")}`;
}

/**
 * `clientes.email` é texto livre: há cadastro com dois endereços no mesmo campo,
 * separados por vírgula, ponto e vírgula ou espaço. Devolve só os válidos, sem
 * repetir e em minúsculas.
 */
export function separarEmails(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  for (const parte of texto.split(/[\s,;]+/)) {
    const e = parte.trim().toLowerCase();
    if (e && emailValido(e)) vistos.add(e);
  }
  return [...vistos];
}
