/**
 * Anexos do e-mail do cliente: extração e a regra do que entra no ticket.
 *
 * A extração é portada do DoctorDev (ler-respostas-email/mime.ts), onde roda
 * desde 11/09/2026 com os formatos reais: imagem colada pelo Gmail como inline
 * dentro de multipart/related, nome com acento em RFC 2047 (Gmail) e RFC 2231
 * com continuação (Outlook). O que muda aqui é só a regra de seleção, ajustada
 * para ticket de suporte (XML de nota fiscal, planilha, ZIP).
 *
 * Convenção: a mensagem entra como string binária, um caractere por byte. É a
 * única forma que não perde bytes de um anexo; o texto do e-mail continua
 * saindo do extrairTexto do imap.ts.
 */

export interface AnexoEmail {
  nome: string;
  mime: string;
  bytes: Uint8Array;
  /** imagem colada no corpo (não veio como "arquivo anexado") */
  inline: boolean;
}

type Cabecalhos = Map<string, string[]>;

// ── bytes e string binária ──────────────────────────────────────────────────

export function bytesParaBinario(bytes: Uint8Array): string {
  // em pedaços: String.fromCharCode(...arrayGigante) estoura a pilha
  const PEDACO = 8192;
  let saida = "";
  for (let i = 0; i < bytes.length; i += PEDACO) {
    saida += String.fromCharCode(...bytes.subarray(i, i + PEDACO));
  }
  return saida;
}

export function binarioParaBytes(s: string): Uint8Array {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

function decodificarComCharset(bytes: Uint8Array, charset: string | null): string {
  const rotulo = (charset ?? "utf-8").toLowerCase().trim();
  try {
    return new TextDecoder(rotulo, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

// ── cabeçalhos ──────────────────────────────────────────────────────────────

function separarMensagem(bruto: string): { cabecalhos: Cabecalhos; corpo: string } {
  let corte = bruto.indexOf("\r\n\r\n");
  let tamanho = 4;
  if (corte < 0) {
    corte = bruto.indexOf("\n\n");
    tamanho = 2;
  }
  if (corte < 0) return { cabecalhos: parseCabecalhos(bruto), corpo: "" };
  return { cabecalhos: parseCabecalhos(bruto.slice(0, corte)), corpo: bruto.slice(corte + tamanho) };
}

function parseCabecalhos(bloco: string): Cabecalhos {
  const mapa: Cabecalhos = new Map();
  const dobradas: string[] = [];

  for (const linha of bloco.split(/\r?\n/)) {
    // linha que começa com espaço ou tab continua a anterior (folding)
    if (/^[ \t]/.test(linha) && dobradas.length > 0) {
      dobradas[dobradas.length - 1] += " " + linha.trim();
    } else if (linha.trim() !== "") {
      dobradas.push(linha);
    }
  }

  for (const linha of dobradas) {
    const sep = linha.indexOf(":");
    if (sep <= 0) continue;
    const nome = linha.slice(0, sep).trim().toLowerCase();
    const valor = linha.slice(sep + 1).trim();
    const atual = mapa.get(nome);
    if (atual) atual.push(valor);
    else mapa.set(nome, [valor]);
  }
  return mapa;
}

function cabecalho(h: Cabecalhos, nome: string): string | null {
  return h.get(nome.toLowerCase())?.[0] ?? null;
}

/** RFC 2047: nome de arquivo com acento no Content-Type (o que o Gmail usa) */
function decodificarPalavrasCodificadas(s: string): string {
  if (!s.includes("=?")) return s;
  // espaço entre duas palavras codificadas vizinhas não é espaço de verdade
  const semEspacoEntre = s.replace(/\?=[ \t]+=\?/g, "?==?");
  return semEspacoEntre.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (inteiro, charset: string, tipo: string, conteudo: string) => {
      try {
        let binario: string;
        if (tipo.toLowerCase() === "b") {
          binario = atob(conteudo.replace(/\s+/g, ""));
        } else {
          binario = conteudo
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
        }
        return decodificarComCharset(binarioParaBytes(binario), charset);
      } catch {
        return inteiro;
      }
    },
  );
}

function parseContentType(valor: string | null): { tipo: string; parametros: Record<string, string> } {
  if (!valor) return { tipo: "text/plain", parametros: {} };

  const partes = dividirRespeitandoAspas(valor, ";");
  const tipo = (partes.shift() ?? "text/plain").trim().toLowerCase();
  const parametros: Record<string, string> = {};

  for (const parte of partes) {
    const sep = parte.indexOf("=");
    if (sep <= 0) continue;
    const chave = parte.slice(0, sep).trim().toLowerCase();
    let bruto = parte.slice(sep + 1).trim();
    if (bruto.startsWith('"') && bruto.endsWith('"') && bruto.length >= 2) {
      bruto = bruto.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    parametros[chave] = bruto;
  }
  return { tipo, parametros };
}

function dividirRespeitandoAspas(s: string, separador: string): string[] {
  const saida: string[] = [];
  let atual = "";
  let dentroDeAspas = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") dentroDeAspas = !dentroDeAspas;
    if (c === separador && !dentroDeAspas) {
      saida.push(atual);
      atual = "";
    } else {
      atual += c;
    }
  }
  saida.push(atual);
  return saida;
}

function decodificarQuotedPrintable(s: string): string {
  return s
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** desfaz o Content-Transfer-Encoding; entra e sai string binária */
function decodificarTransferencia(corpoBinario: string, transferencia: string | null): string {
  const cte = (transferencia ?? "7bit").toLowerCase().trim();
  if (cte === "base64") {
    try {
      return atob(corpoBinario.replace(/\s+/g, ""));
    } catch {
      return corpoBinario;
    }
  }
  if (cte === "quoted-printable") return decodificarQuotedPrintable(corpoBinario);
  return corpoBinario;
}

function separarPartes(corpo: string, fronteira: string): string[] {
  const pedacos = corpo.split("--" + fronteira);
  // o primeiro pedaço é o preâmbulo; o que começa com "--" é a fronteira final
  const partes: string[] = [];
  for (let i = 1; i < pedacos.length; i++) {
    const pedaco = pedacos[i];
    if (pedaco.startsWith("--")) break;
    partes.push(pedaco.replace(/^\r?\n/, ""));
  }
  return partes;
}

// ── extração ────────────────────────────────────────────────────────────────

export function extrairAnexos(brutoBinario: string): AnexoEmail[] {
  const { cabecalhos: h, corpo } = separarMensagem(brutoBinario);
  const saida: AnexoEmail[] = [];
  coletarAnexos(h, corpo, 0, saida);
  return saida;
}

function coletarAnexos(h: Cabecalhos, corpo: string, profundidade: number, saida: AnexoEmail[]) {
  if (profundidade > 12) return;

  const { tipo, parametros } = parseContentType(cabecalho(h, "content-type"));

  if (tipo.startsWith("multipart/")) {
    const fronteira = parametros["boundary"];
    if (!fronteira) return;
    for (const parte of separarPartes(corpo, fronteira)) {
      const { cabecalhos: ph, corpo: pc } = separarMensagem(parte);
      coletarAnexos(ph, pc, profundidade + 1, saida);
    }
    return;
  }

  // e-mail encaminhado dentro do e-mail: os anexos dele não são do cliente
  if (tipo === "message/rfc822") return;

  const dispBruta = cabecalho(h, "content-disposition");
  const disp = dispBruta ? parseContentType(dispBruta) : { tipo: "", parametros: {} as Record<string, string> };
  const ehArquivo = disp.tipo === "attachment";

  // o texto do corpo é do extrairTexto; texto mandado como arquivo é anexo
  if ((tipo === "text/plain" || tipo === "text/html") && !ehArquivo) return;

  let binario = decodificarTransferencia(corpo, cabecalho(h, "content-transfer-encoding"));
  // em 7bit/8bit/binary o CRLF antes da próxima fronteira pertence a ela
  if (!/base64|quoted-printable/i.test(cabecalho(h, "content-transfer-encoding") ?? "")) {
    binario = binario.replace(/\r?\n$/, "");
  }
  const bytes = binarioParaBytes(binario);
  if (bytes.length === 0) return;

  const nome =
    nomeDoArquivo(disp.parametros, "filename") ??
    nomeDoArquivo(parametros, "name") ??
    `anexo-${saida.length + 1}${extensaoDoTipo(tipo)}`;

  saida.push({ nome, mime: tipo, bytes, inline: !ehArquivo });
}

/**
 * `filename="x.png"`, `filename="=?UTF-8?B?…?="` (RFC 2047, Gmail) ou
 * `filename*=UTF-8''relat%C3%B3rio.pdf`, com ou sem continuação
 * `filename*0*=…; filename*1*=…` (RFC 2231, Outlook).
 */
function nomeDoArquivo(p: Record<string, string>, base: string): string | null {
  if (p[`${base}*`] !== undefined) return decodificarRfc2231(p[`${base}*`]);

  const pedacos: string[] = [];
  let codificado = false;
  for (let i = 0; ; i++) {
    const cod = p[`${base}*${i}*`];
    const cru = p[`${base}*${i}`];
    if (cod === undefined && cru === undefined) break;
    if (cod !== undefined && i === 0) codificado = true;
    pedacos.push(cod ?? cru);
  }
  if (pedacos.length > 0) {
    const junto = pedacos.join("");
    return codificado ? decodificarRfc2231(junto) : junto;
  }

  const simples = p[base];
  return simples ? decodificarPalavrasCodificadas(simples) : null;
}

function decodificarRfc2231(valor: string): string {
  // charset'idioma'texto-com-%XX; o charset só vem no primeiro pedaço
  const m = valor.match(/^([^']*)'[^']*'([\s\S]*)$/);
  const charset = m?.[1] || "utf-8";
  const texto = m ? m[2] : valor;
  const binario = texto.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  return decodificarComCharset(binarioParaBytes(binario), charset);
}

function extensaoDoTipo(tipo: string): string {
  const mapa: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/xml": ".xml",
    "text/xml": ".xml",
    "text/csv": ".csv",
    "application/zip": ".zip",
    "video/mp4": ".mp4",
  };
  return mapa[tipo] ?? "";
}

// ── o que entra no ticket ───────────────────────────────────────────────────

export const ANEXO_MAX_BYTES = 25 * 1024 * 1024;
/** imagem colada no corpo menor que isso é pixel de rastreio ou espaçador, não print */
export const ANEXO_INLINE_MIN_BYTES = 2048;
export const ANEXO_MAX_POR_MENSAGEM = 10;

const TIPOS_ACEITOS = new Set([
  "application/pdf",
  "application/xml",
  "text/csv",
  "text/plain",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
]);
const PREFIXOS_ACEITOS = ["image/", "video/", "audio/"];
/** SVG é imagem, mas carrega script, e a tela de anexos abre o arquivo dentro do app */
const TIPOS_RECUSADOS = new Set(["image/svg+xml"]);

const APELIDOS: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "text/xml": "application/xml",
  "application/x-zip-compressed": "application/zip",
  "application/x-zip": "application/zip",
};

/** tipo genérico (octet-stream) com extensão conhecida: vale a extensão */
const POR_EXTENSAO: Record<string, string> = {
  pdf: "application/pdf",
  xml: "application/xml",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  mp4: "video/mp4",
};

export function normalizarMime(mime: string, nome: string): string {
  let m = APELIDOS[mime] ?? mime;
  if (!m || m === "application/octet-stream") {
    const ext = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : "";
    m = POR_EXTENSAO[ext] ?? (m || "application/octet-stream");
  }
  return m;
}

/** separa o que entra no ticket do que fica de fora, com o motivo */
export function selecionarAnexos(todos: AnexoEmail[]): { aceitos: AnexoEmail[]; ignorados: string[] } {
  const aceitos: AnexoEmail[] = [];
  const ignorados: string[] = [];

  for (const a of todos) {
    const mime = normalizarMime(a.mime, a.nome);
    const aceito = !TIPOS_RECUSADOS.has(mime) && (TIPOS_ACEITOS.has(mime) || PREFIXOS_ACEITOS.some((p) => mime.startsWith(p)));
    if (!aceito) {
      ignorados.push(`${a.nome} (tipo não aceito: ${a.mime})`);
      continue;
    }
    // pixel de rastreio e espaçador saem calados: não são do cliente
    if (a.inline && mime.startsWith("image/") && a.bytes.length < ANEXO_INLINE_MIN_BYTES) continue;
    if (a.bytes.length > ANEXO_MAX_BYTES) {
      ignorados.push(`${a.nome} (maior que 25 MB)`);
      continue;
    }
    if (aceitos.length >= ANEXO_MAX_POR_MENSAGEM) {
      ignorados.push(`${a.nome} (passou de ${ANEXO_MAX_POR_MENSAGEM} arquivos por e-mail)`);
      continue;
    }
    aceitos.push({ ...a, mime });
  }

  return { aceitos, ignorados };
}

/** nome que o Storage aceita: sem acento, sem espaço, extensão preservada */
export function nomeSeguro(nome: string, posicao: number): string {
  const limpo = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+/, "");
  const ponto = limpo.lastIndexOf(".");
  const ext = ponto > 0 ? limpo.slice(ponto, ponto + 11) : "";
  const raiz = (ponto > 0 ? limpo.slice(0, ponto) : limpo).slice(0, 80);
  return (raiz || `anexo-${posicao + 1}`) + ext;
}

/**
 * Caminho fixo no bucket: tenant / email / hash da mensagem - posição - nome.
 * O mesmo e-mail sempre cai no mesmo caminho, então subir de novo (upsert)
 * regrava o arquivo em vez de criar um órfão.
 */
export async function caminhoDoAnexo(tenantId: string, chaveDaMensagem: string, posicao: number, nome: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(chaveDaMensagem));
  const prefixo = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return `${tenantId}/email/${prefixo}-${posicao + 1}-${nomeSeguro(nome, posicao)}`;
}
