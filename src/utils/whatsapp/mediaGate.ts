/**
 * Regras de "esta mensagem tem mídia?" — em módulo puro de propósito.
 *
 * Estavam espalhadas em três arquivos, cada uma com um recorte diferente, e o
 * desencontro entre elas era o bug: o evolution-webhook NÃO baixa mídia acima de
 * MAX_INLINE_MEDIA_BYTES (12 MB) e grava a mensagem com mimetype e tamanho,
 * deixando `media_url` NULL de propósito ("para nunca sumir"). Só que os gates
 * do frontend exigiam `media_url` para tudo que não fosse `document` — então
 * vídeo, imagem e áudio acima do teto não renderizavam NADA: sobrava o texto
 * "🎥 Vídeo" que o próprio webhook grava como conteúdo.
 *
 * Medido na Athuz em 04/08/2026: 6 dos 77 vídeos (8%), o maior com 92 MB.
 */

/** Tipos que nunca carregam anexo. O resto é candidato a mídia. */
const NON_MEDIA_TYPES = new Set(["text", "contact", "contacts"]);

export interface MediaFields {
  message_type: string;
  media_url?: string | null;
  media_path?: string | null;
  media_filename?: string | null;
  media_size_bytes?: number | null;
  media_mimetype?: string | null;
}

/**
 * Vale renderizar algo de mídia para esta mensagem?
 *
 * `media_url` NÃO é o critério: sem ele a mídia pode existir mesmo assim, só que
 * fora do nosso Storage. Qualquer rastro (caminho, nome, tamanho ou mimetype)
 * basta para mostrar o card com "abra pelo WhatsApp" em vez de uma bolha vazia.
 */
export function hasRenderableMedia(msg: MediaFields): boolean {
  if (NON_MEDIA_TYPES.has(msg.message_type)) return false;
  return Boolean(
    msg.media_url ||
    msg.media_path ||
    msg.media_filename ||
    msg.media_size_bytes != null ||
    msg.media_mimetype
  );
}

/**
 * Dá para BUSCAR os bytes? Só com `media_url` ou `media_path`; sem eles o
 * whatsapp-media-proxy responde 404 ("No media path available"), então nem
 * adianta tentar — é direto para o card.
 */
export function hasRetrievableMedia(msg: Pick<MediaFields, "media_url" | "media_path">): boolean {
  return Boolean(msg.media_url || msg.media_path);
}

/**
 * Rótulos que o evolution-webhook grava em `content` quando a mídia chega SEM
 * legenda (ver `descriptions` no getMessageContent). Não são texto do cliente —
 * são placeholder. Com o card de mídia na tela eles viram eco: o card já diz
 * "Vídeo" e logo abaixo aparecia "🎥 Vídeo" de novo.
 */
const MEDIA_PLACEHOLDER_CONTENT = new Set([
  "📷 Imagem",
  "🎵 Áudio",
  "🎥 Vídeo",
  "📄 Documento",
  "🎨 Sticker",
]);

/**
 * O `content` é só o placeholder do webhook (e portanto redundante com o card),
 * ou é legenda de verdade escrita pelo cliente?
 */
export function isMediaPlaceholderContent(content: string | null | undefined): boolean {
  if (!content) return false;
  return MEDIA_PLACEHOLDER_CONTENT.has(content.trim());
}

/**
 * É PDF? Decide se o anexo ganha o preview em tela cheia em vez de só "abrir e
 * baixar".
 *
 * Os três campos entram porque nenhum é confiável sozinho: o Evolution manda ora
 * só o `fileName`, ora só o `mimetype`, e `media_ext` fica NULL quando o nome do
 * arquivo veio sem extensão. Exigir os três deixaria PDF de fora do preview.
 */
export function isPdfAttachment(fields: {
  ext?: string | null;
  mime?: string | null;
  filename?: string | null;
}): boolean {
  const ext = fields.ext?.trim().replace(/^\./, "").toLowerCase();
  if (ext === "pdf") return true;
  if (fields.mime?.trim().toLowerCase().startsWith("application/pdf")) return true;
  return /\.pdf$/i.test(fields.filename?.trim() ?? "");
}

/** message_type → kind do AttachmentCard, para cair o ícone e o rótulo certos. */
export function kindFromMessageType(messageType: string): string {
  switch (messageType) {
    case "image":
    case "sticker":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "document":
      return "document";
    default:
      return "other";
  }
}
