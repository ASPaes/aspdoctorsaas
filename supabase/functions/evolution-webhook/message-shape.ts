// ─────────────────────────────────────────────────────────────────────────────
// Leitura dos formatos de mensagem do Baileys que a Evolution entrega.
//
// Mora aqui, e não no _shared, de propósito: o CI deploya TODAS as functions
// quando o _shared muda, e só a que mudou quando não. É código puro (sem Deno,
// sem rede), então roda no vitest — ver message-shape.test.ts, que documenta os
// formatos medidos em produção.
//
// A regra que faltava: só um punhado de formatos era reconhecido; todo o resto
// virava o texto literal "📎 Mensagem não suportada", gravado no banco como se
// fosse o conteúdo. 388 mensagens em 19 dias (medido em 10/08/2026).
// ─────────────────────────────────────────────────────────────────────────────
import { UNSUPPORTED_MESSAGE_LABEL } from '../_shared/message-types.ts';
import type { MessageType } from '../_shared/message-types.ts';

/** Chaves que só embrulham outra mensagem — nunca carregam conteúdo próprio. */
const ENVELOPE_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

/**
 * Chaves que NÃO devem virar mensagem no chat.
 * - albumMessage: só anuncia o álbum; cada foto chega como mensagem separada
 *   logo depois (conferido em prod: álbum às 14:39:29 → 7 imagens até 14:40:24).
 * - messageHistoryNotice: aviso de sincronização de histórico do aparelho.
 * - call: registro de chamada. Vira mensagem → a URA responderia a uma ligação.
 * - pinInChatMessage: alguém fixou uma mensagem.
 */
const NOISE_KEYS = new Set(['albumMessage', 'messageHistoryNotice', 'call', 'pinInChatMessage']);

/** Primeiro valor que seja string não vazia. */
function firstText(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v;
  return '';
}

export function unwrapMessage(message: any, depth = 0): any {
  if (!message || typeof message !== 'object' || depth > 5) return message || {};
  const inner =
    message.ephemeralMessage?.message ||
    message.viewOnceMessage?.message ||
    message.viewOnceMessageV2?.message ||
    message.viewOnceMessageV2Extension?.message ||
    message.documentWithCaptionMessage?.message ||
    // Filho de álbum: a mídia de verdade está aqui dentro.
    message.associatedChildMessage?.message ||
    null;
  return inner ? unwrapMessage(inner, depth + 1) : message;
}

/**
 * Descarte antes de gravar. Devolve o motivo (string) ou `false`.
 * Conservador de propósito: basta UMA chave de conteúdo para não descartar.
 */
export function isIgnorableMessage(message: any): string | false {
  const m = unwrapMessage(message);
  if (!m || typeof m !== 'object') return 'vazio';
  const keys = Object.keys(m).filter((k) => !ENVELOPE_KEYS.has(k) && m[k] != null);
  if (keys.length === 0) return 'vazio';
  const noise = keys.find((k) => NOISE_KEYS.has(k));
  return keys.every((k) => NOISE_KEYS.has(k)) ? (noise as string) : false;
}

export function getMessageType(message: any): MessageType {
  message = unwrapMessage(message);
  if (!message) return 'text';
  if (message.reactionMessage) return 'reaction';
  if (message.protocolMessage?.type === 0 || message.protocolMessage?.type === 'REVOKE') return 'revoke';
  if (message.conversation || message.extendedTextMessage) return 'text';
  if (message.imageMessage) return 'image';
  if (message.audioMessage) return 'audio';
  if (message.videoMessage) return 'video';
  // Vídeo redondo (push-to-video) — mesma mídia, outro nó.
  if (message.ptvMessage) return 'video';
  // PATCH: handle documentWithCaptionMessage wrapper (Evolution API v2)
  if (message.documentWithCaptionMessage?.message?.documentMessage) return 'document';
  if (message.documentMessage) return 'document';
  if (message.stickerMessage) return 'sticker';
  if (message.lottieStickerMessage) return 'sticker';
  if (message.contactMessage) return 'contact';
  if (message.contactsArrayMessage) return 'contacts';
  return 'text';
}

/**
 * Nó que carrega mimetype/fileLength/caption da mídia. O tipo nem sempre bate
 * com `<type>Message`: ptv é vídeo, lottie é sticker, documento pode vir
 * embrulhado. Quem baixa precisa do nó certo para ler o tamanho declarado.
 */
export function resolveMediaNode(message: any, type: string): any | null {
  message = unwrapMessage(message);
  if (!message || typeof message !== 'object') return null;
  switch (type) {
    case 'document':
      return message.documentMessage || message.documentWithCaptionMessage?.message?.documentMessage || null;
    case 'video':
      return message.videoMessage || message.ptvMessage || null;
    case 'sticker':
      return message.stickerMessage || message.lottieStickerMessage?.message?.stickerMessage
        || message.lottieStickerMessage || null;
    default:
      return message[`${type}Message`] || null;
  }
}

function templateText(t: any): string {
  const h = t?.hydratedTemplate || t?.hydratedFourRowTemplate || t?.interactiveMessageTemplate || null;
  const four = t?.fourRowTemplate || null;
  return firstText(
    h?.hydratedContentText, h?.hydratedTitleText, h?.hydratedFooterText,
    four?.content?.text, four?.title?.text, four?.footer?.text,
  );
}

/**
 * Preço do card de catálogo. O Baileys manda o valor em milésimos e, por ser
 * int64, o protobuf entrega como STRING — daí aceitar os dois.
 */
function productPrice(prod: any): string {
  const raw = prod?.priceAmount1000 ?? prod?.salePriceAmount1000;
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '';
  const code = typeof prod?.currencyCode === 'string' && /^[A-Za-z]{3}$/.test(prod.currencyCode)
    ? prod.currencyCode.toUpperCase()
    : 'BRL';
  try {
    // O Intl separa "R$" do número com espaço NBSP; troca por espaço normal
    // para o texto gravado no banco continuar pesquisável.
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: code })
      .format(n / 1000)
      .replace(/\u00A0/g, ' ');
  } catch {
    return (n / 1000).toFixed(2);
  }
}

/**
 * Card de produto do catálogo do WhatsApp Business. O cliente manda um item do
 * catálogo dele e o chat mostrava "📎 Mensagem não suportada" (medido em prod:
 * 3 casos desde o fix de 10/08 — 12/08, 26/08 e 27/08).
 *
 * Fica em `text` de propósito: a foto vive em `product.productImage`, que não é
 * uma mensagem de mídia que a Evolution saiba servir pelo `key` — pedir download
 * daria spinner eterno no chat.
 */
function productText(p: any): string {
  const prod = p?.product || {};
  const head = [firstText(prod.title), productPrice(prod)].filter(Boolean).join(' — ');
  if (head) return `🛍️ ${head}`;
  const desc = firstText(prod.description);
  return desc ? `🛍️ ${desc}` : '🛍️ Produto do catálogo';
}

function interactiveResponseText(r: any): string {
  const body = firstText(r?.body?.text);
  if (body) return body;
  const raw = r?.nativeFlowResponseMessage?.paramsJson;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      return firstText(p?.description, p?.title, p?.selectedDisplayText, p?.selectedRowId, p?.id);
    } catch { /* paramsJson quebrado: cai no rótulo genérico */ }
  }
  return '';
}

export function getMessageContent(message: any, type: string): string {
  message = unwrapMessage(message);
  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  // Respostas interativas: o texto É a escolha do cliente
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText;
  if (message.templateButtonReplyMessage?.selectedDisplayText) return message.templateButtonReplyMessage.selectedDisplayText;
  if (message.listResponseMessage) {
    const l = message.listResponseMessage;
    return l.title || l.singleSelectReply?.selectedRowId || l.description || '📋 Resposta de lista';
  }
  // Resposta a menu nativo (nativeFlow). A URA lê este texto para casar a opção.
  if (message.interactiveResponseMessage) {
    return interactiveResponseText(message.interactiveResponseMessage) || '💬 Resposta';
  }
  if (message.contactMessage) return message.contactMessage.displayName || '📇 Contato';
  if (message.contactsArrayMessage) {
    const count = message.contactsArrayMessage.contacts?.length || 0;
    return `📇 ${count} contato${count !== 1 ? 's' : ''}`;
  }
  const mediaMessage = resolveMediaNode(message, type);
  if (mediaMessage?.caption) return mediaMessage.caption;
  if (type === 'reaction') {
    return message.reactionMessage?.text || '';
  }
  // Enquete / localização → rótulo (permanece message_type='text')
  const poll = message.pollCreationMessage || message.pollCreationMessageV2 || message.pollCreationMessageV3;
  if (poll) return `📊 Enquete: ${poll.name || ''}`.trim();
  if (message.locationMessage || message.liveLocationMessage) return '📍 Localização';

  // Mensagens de robô / conta comercial: têm texto, e o texto é o que interessa.
  if (message.templateMessage) return templateText(message.templateMessage) || '📋 Mensagem de modelo';
  if (message.buttonsMessage) {
    const b = message.buttonsMessage;
    return firstText(b.contentText, b.text, b.headerText, b.footerText) || '🔘 Mensagem com botões';
  }
  if (message.listMessage) {
    const l = message.listMessage;
    return firstText(l.description, l.title, l.footerText, l.buttonText) || '📋 Menu de opções';
  }
  if (message.interactiveMessage) {
    const i = message.interactiveMessage;
    return firstText(i.body?.text, i.header?.title, i.header?.subtitle, i.footer?.text) || '💬 Mensagem interativa';
  }
  if (message.productMessage) return productText(message.productMessage);
  if (message.groupInviteMessage) {
    const name = firstText(message.groupInviteMessage.groupName);
    return name ? `👥 Convite para o grupo "${name}"` : '👥 Convite para grupo';
  }

  const descriptions: Record<string, string> = {
    image: '📷 Imagem', audio: '🎵 Áudio', video: '🎥 Vídeo',
    document: '📄 Documento', sticker: '🎨 Sticker',
  };
  return descriptions[type] || UNSUPPORTED_MESSAGE_LABEL;
}
