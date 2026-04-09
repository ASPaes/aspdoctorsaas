// ─────────────────────────────────────────────────────────────────────────────
// Tipos compartilhados entre todos os webhooks de mensagens
// Usado por: evolution-webhook, zapi-webhook, meta-webhook, message-processor
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderType = 'self_hosted' | 'cloud' | 'zapi' | 'meta_cloud';

export type MessageType =
  | 'text' | 'image' | 'audio' | 'video' | 'document'
  | 'sticker' | 'contact' | 'contacts' | 'reaction' | 'revoke' | 'system';

export interface InstanceSecrets {
  api_url?: string | null;
  api_key?: string | null;
  zapi_instance_id?: string | null;
  zapi_token?: string | null;
  zapi_client_token?: string | null;
  meta_access_token?: string | null;
}

export interface InstanceInfo {
  id: string;
  instance_name: string;
  provider_type: ProviderType;
  instance_id_external?: string | null;
  meta_phone_number_id?: string | null;
  skip_ura?: boolean;
  tenant_id: string;
}

/**
 * Formato interno normalizado — igual para todos os providers.
 * Cada webhook converte seu payload para este formato antes de chamar o processor.
 */
export interface NormalizedInboundMessage {
  // Identificação da instância
  instanceId: string;
  tenantId: string;
  providerType: ProviderType;
  instanceInfo: InstanceInfo;
  secrets: InstanceSecrets;

  // Mensagem
  messageId: string;
  remoteJid: string;       // E.164 sem sufixo, ex: "5549991210660"
  fromMe: boolean;
  pushName: string;
  content: string;
  messageType: MessageType;
  timestamp: string;       // ISO 8601

  // Mídia (opcional)
  mediaUrl?: string | null;
  mediaMimetype?: string | null;
  mediaFilename?: string | null;
  mediaStoragePath?: string | null;

  // Contexto (opcional)
  quotedMessageId?: string | null;
  reactionEmoji?: string | null;
  reactionTargetMessageId?: string | null;

  // Raw para fallback/debug
  rawPayload?: unknown;
}

/**
 * Contexto de envio — usado pelo processor para enviar mensagens automáticas
 * (URA, business hours, CSAT) de volta ao cliente via o provider correto.
 */
export interface SendContext {
  instanceId: string;
  tenantId: string;
  providerType: ProviderType;
  instanceInfo: InstanceInfo;
  secrets: InstanceSecrets;
  remoteJid: string;       // destino no formato JID completo ex: "5549991210660@s.whatsapp.net"
  contactName: string;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface PhoneParseResult {
  phone: string;           // normalizado E.164
  isGroup: boolean;
}
