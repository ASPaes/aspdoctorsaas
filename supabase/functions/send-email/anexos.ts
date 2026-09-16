/**
 * Regras do anexo enviado pela tela "Enviar e-mail" do chat.
 *
 * Espelha `src/components/whatsapp/chat/email/travaEnvioEmail.ts` (a tela
 * confere antes de subir, o servidor confere de novo): mudou um, mude o outro.
 * Os tipos seguem os do robô de Recebidos (`ler-emails-recebidos/anexos.ts`).
 *
 * Onde o arquivo mora: bucket `whatsapp-media`, subido pela `get-media-upload-url`
 * (mesmo caminho do anexo do chat), em `<tenant>/<conversa>/<uuid>.<ext>`.
 * A `purge-chat-media` só apaga mídia ligada a mensagem, então quem apaga o
 * anexo do e-mail é a própria send-email, depois de enviar.
 */

export const ANEXO_BUCKET = "whatsapp-media";
export const ANEXO_MAX_ARQUIVOS = 10;
/** somados: em base64 o e-mail cresce ~37%, e 18 MB viram ~25 MB, o teto de Gmail e Outlook */
export const ANEXO_MAX_TOTAL_BYTES = 18 * 1024 * 1024;

const TIPOS = new Set([
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
const PREFIXOS = ["image/", "video/", "audio/"];
const EXTENSOES = new Set([
  "pdf", "xml", "csv", "txt", "zip", "doc", "docx", "xls", "xlsx", "odt", "ods",
  "jpg", "jpeg", "png", "gif", "webp", "heic", "mp4", "mov", "mp3", "ogg", "wav", "m4a",
]);

/** SVG é imagem, mas carrega script: fica de fora como no Recebidos */
export function tipoPermitido(mime: string, nome: string): boolean {
  const tipo = (mime || "").toLowerCase().split(";")[0].trim();
  if (tipo === "image/svg+xml" || /\.svg$/i.test(nome)) return false;
  if (TIPOS.has(tipo) || PREFIXOS.some((p) => tipo.startsWith(p))) return true;
  // navegador que manda tipo vazio ou genérico: decide pela extensão
  if (!tipo || tipo === "application/octet-stream") {
    return EXTENSOES.has((nome.split(".").pop() || "").toLowerCase());
  }
  return false;
}

export interface AnexoPedido {
  path: string;
  nome: string;
  mime: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Confere o que a tela mandou antes de baixar qualquer coisa do Storage. O
 * caminho precisa ser do próprio tenant e ter o formato exato que a
 * get-media-upload-url gera: é isso que impede pedir arquivo de outro tenant.
 */
export function validarAnexos(
  lista: unknown,
  tenantId: string,
): { ok: true; anexos: AnexoPedido[] } | { ok: false; erro: string } {
  if (lista === undefined || lista === null) return { ok: true, anexos: [] };
  if (!Array.isArray(lista)) return { ok: false, erro: "Lista de anexos inválida." };
  if (lista.length > ANEXO_MAX_ARQUIVOS) {
    return { ok: false, erro: `No máximo ${ANEXO_MAX_ARQUIVOS} arquivos por e-mail.` };
  }

  // dois formatos, os dois gerados pela get-media-upload-url:
  //   <tenant>/<conversa>/<uuid>.<ext>  anexo escolhido no chat
  //   <tenant>/emails/<uuid>.<ext>      anexo escolhido na tela E-mails
  const caminho = new RegExp(`^${tenantId}/(?:${UUID}|emails)/${UUID}\\.[a-z0-9]{1,5}$`, "i");
  const anexos: AnexoPedido[] = [];
  for (const item of lista) {
    const path = typeof item?.path === "string" ? item.path : "";
    const nome = typeof item?.nome === "string" ? item.nome.trim() : "";
    const mime = typeof item?.mime === "string" ? item.mime.trim() : "";
    if (!caminho.test(path)) return { ok: false, erro: "Anexo inválido: arquivo fora da área do seu tenant." };
    if (!nome) return { ok: false, erro: "Anexo sem nome." };
    if (!tipoPermitido(mime, nome)) return { ok: false, erro: `Tipo de arquivo não aceito: ${nome}` };
    anexos.push({ path, nome: nome.slice(0, 150), mime: mime || "application/octet-stream" });
  }
  return { ok: true, anexos };
}

/** base64 em pedaços: String.fromCharCode(...bytes) estoura a pilha em arquivo grande */
export function bytesParaBase64(bytes: Uint8Array): string {
  let binario = "";
  const passo = 0x8000;
  for (let i = 0; i < bytes.length; i += passo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + passo));
  }
  return btoa(binario);
}
