// Provider Adapter — ponto central de roteamento por provider_type
// Suporta: Evolution (self_hosted/cloud), Z-API (zapi), Meta Cloud (meta_cloud)

export type ProviderType = 'self_hosted' | 'cloud' | 'zapi' | 'meta_cloud';

export interface InstanceSecrets {
  // Evolution
  api_url?: string | null;
  api_key?: string | null;
  // Z-API
  zapi_instance_id?: string | null;
  zapi_token?: string | null;
  zapi_webhook_token?: string | null;
  zapi_client_token?: string | null;
  // Meta Cloud
  meta_access_token?: string | null;
}

export interface InstanceInfo {
  id: string;
  instance_name: string;
  provider_type: ProviderType;
  instance_id_external?: string | null;
  meta_phone_number_id?: string | null;
}

export interface ConnectionStatus {
  connected: boolean;
  phoneNumber?: string;
  state?: string;
  error?: string;
}

export interface SendRequest {
  to: string; // E.164 or JID
  messageType: 'text' | 'image' | 'audio' | 'video' | 'document';
  content?: string;
  mediaUrl?: string;
  mediaBase64?: string;
  mediaMimetype?: string;
  fileName?: string;
  quotedMessageId?: string;
}

export interface SendResult {
  messageId: string;
  raw: unknown;
}

export interface ProviderAdapter {
  /** Testa conexão e retorna status */
  checkStatus(secrets: InstanceSecrets, instance: InstanceInfo): Promise<ConnectionStatus>;
  /** Constrói e envia mensagem — retorna messageId externo */
  send(secrets: InstanceSecrets, instance: InstanceInfo, msg: SendRequest): Promise<SendResult>;
  /** Configura webhook (se suportado pelo provider) */
  configureWebhook(
    secrets: InstanceSecrets,
    instance: InstanceInfo,
    webhookUrl: string
  ): Promise<{ ok: boolean; action: string }>;
}

// ── Evolution Adapter ─────────────────────────────────────────────────────────

class EvolutionAdapter implements ProviderAdapter {
  private getIdentifier(secrets: InstanceSecrets, instance: InstanceInfo): string {
    return instance.provider_type === 'cloud' && instance.instance_id_external
      ? instance.instance_id_external
      : instance.instance_name;
  }

  private getBaseUrl(secrets: InstanceSecrets): string {
    const url = secrets.api_url || '';
    return url.replace(/\/$/, '').replace(/\/manager$/, '');
  }

  private getHeaders(secrets: InstanceSecrets): Record<string, string> {
    return { apikey: secrets.api_key || '' };
  }

  async checkStatus(secrets: InstanceSecrets, instance: InstanceInfo): Promise<ConnectionStatus> {
    const base = this.getBaseUrl(secrets);
    const id = this.getIdentifier(secrets, instance);
    const res = await fetch(`${base}/instance/connectionState/${id}`, {
      headers: this.getHeaders(secrets),
    });
    if (!res.ok) return { connected: false, error: await res.text() };
    const data = await res.json();
    const state = data?.state || data?.instance?.state || '';
    return {
      connected: state === 'open',
      state,
      phoneNumber: data?.instance?.profilePictureUrl ? undefined : undefined,
    };
  }

  async send(secrets: InstanceSecrets, instance: InstanceInfo, msg: SendRequest): Promise<SendResult> {
    const base = this.getBaseUrl(secrets);
    const id = this.getIdentifier(secrets, instance);
    const headers = { ...this.getHeaders(secrets), 'Content-Type': 'application/json' };

    let endpoint: string;
    let body: Record<string, unknown>;

    switch (msg.messageType) {
      case 'text': {
        endpoint = `${base}/message/sendText/${id}`;
        body = { number: msg.to, text: msg.content };
        if (msg.quotedMessageId) body.quoted = { key: { id: msg.quotedMessageId } };
        break;
      }
      case 'audio': {
        endpoint = `${base}/message/sendWhatsAppAudio/${id}`;
        const audio = msg.mediaUrl || (msg.mediaBase64?.startsWith('data:')
          ? msg.mediaBase64.split(',')[1]
          : msg.mediaBase64);
        body = { number: msg.to, audio };
        break;
      }
      default: {
        endpoint = `${base}/message/sendMedia/${id}`;
        body = {
          number: msg.to,
          mediatype: msg.messageType,
          media: msg.mediaUrl,
          caption: msg.content,
          ...(msg.messageType === 'document' && msg.fileName ? { fileName: msg.fileName } : {}),
        };
      }
    }

    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Evolution send error: ${await res.text()}`);
    const data = await res.json();
    return { messageId: data?.key?.id || `evo_${Date.now()}`, raw: data };
  }

  async configureWebhook(
    secrets: InstanceSecrets,
    instance: InstanceInfo,
    webhookUrl: string
  ): Promise<{ ok: boolean; action: string }> {
    const base = this.getBaseUrl(secrets);
    const id = this.getIdentifier(secrets, instance);
    const headers = { ...this.getHeaders(secrets), 'Content-Type': 'application/json' };
    const requiredEvents = [
      'APPLICATION_STARTUP', 'MESSAGES_UPSERT', 'MESSAGES_UPDATE',
      'MESSAGES_DELETE', 'SEND_MESSAGE', 'CONNECTION_UPDATE',
    ];

    // Check current
    const checkRes = await fetch(`${base}/webhook/find/${id}`, { headers: this.getHeaders(secrets) });
    if (checkRes.ok) {
      const current = await checkRes.json();
      const currentUrl = current?.url || current?.webhook?.url || '';
      const currentEnabled = current?.enabled ?? current?.webhook?.enabled ?? false;
      const rawEvents = current?.events || current?.webhook?.events || [];
      const configured = (Array.isArray(rawEvents) ? rawEvents : [rawEvents])
        .map((e: unknown) => String(e).toUpperCase().trim());
      if (currentEnabled && currentUrl === webhookUrl && requiredEvents.every(e => configured.includes(e))) {
        return { ok: true, action: 'noop' };
      }
    }

    const setRes = await fetch(`${base}/webhook/set/${id}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: webhookUrl, enabled: true, webhookByEvents: false, webhookBase64: false, events: requiredEvents }),
    });
    if (!setRes.ok) return { ok: false, action: 'reconfigure_failed' };
    return { ok: true, action: 'reconfigured' };
  }
}

// ── Z-API Adapter ─────────────────────────────────────────────────────────────

class ZApiAdapter implements ProviderAdapter {
  private getBaseUrl(secrets: InstanceSecrets): string {
    return `https://api.z-api.io/instances/${secrets.zapi_instance_id}/token/${secrets.zapi_token}`;
  }

  private getHeaders(secrets: InstanceSecrets): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secrets.zapi_client_token) {
      headers['Client-Token'] = secrets.zapi_client_token;
    }
    return headers;
  }

  async checkStatus(secrets: InstanceSecrets, _instance: InstanceInfo): Promise<ConnectionStatus> {
    const base = this.getBaseUrl(secrets);
    const res = await fetch(`${base}/status`, { headers: this.getHeaders() });
    if (!res.ok) return { connected: false, error: await res.text() };
    const data = await res.json();
    const connected = data?.connected === true || data?.status === 'connected';
    return { connected, phoneNumber: data?.phone, state: data?.status };
  }

  async send(secrets: InstanceSecrets, _instance: InstanceInfo, msg: SendRequest): Promise<SendResult> {
    const base = this.getBaseUrl(secrets);
    const headers = this.getHeaders();
    const phone = msg.to.replace(/\D/g, '');

    let endpoint: string;
    let body: Record<string, unknown>;

    switch (msg.messageType) {
      case 'text': {
        endpoint = `${base}/send-text`;
        body = { phone, message: msg.content };
        if (msg.quotedMessageId) body.messageId = msg.quotedMessageId;
        break;
      }
      case 'image': {
        endpoint = `${base}/send-image`;
        body = { phone, image: msg.mediaUrl, caption: msg.content };
        break;
      }
      case 'audio': {
        endpoint = `${base}/send-audio`;
        body = { phone, audio: msg.mediaUrl };
        break;
      }
      case 'video': {
        endpoint = `${base}/send-video`;
        body = { phone, video: msg.mediaUrl, caption: msg.content };
        break;
      }
      case 'document': {
        endpoint = `${base}/send-document/${msg.mediaMimetype || 'application/pdf'}`;
        body = { phone, document: msg.mediaUrl, fileName: msg.fileName };
        break;
      }
      default:
        throw new Error(`Z-API: tipo não suportado: ${msg.messageType}`);
    }

    const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Z-API send error: ${await res.text()}`);
    const data = await res.json();
    return { messageId: data?.zaapId || data?.messageId || `zapi_${Date.now()}`, raw: data };
  }

  async configureWebhook(
    _secrets: InstanceSecrets,
    _instance: InstanceInfo,
    _webhookUrl: string
  ): Promise<{ ok: boolean; action: string }> {
    // Z-API configura webhook via painel — não suportado por API
    return { ok: true, action: 'noop_zapi_manual' };
  }
}

// ── Meta Cloud Adapter ────────────────────────────────────────────────────────

class MetaCloudAdapter implements ProviderAdapter {
  private readonly graphBase = 'https://graph.facebook.com/v21.0';

  async checkStatus(secrets: InstanceSecrets, instance: InstanceInfo): Promise<ConnectionStatus> {
    const phoneId = instance.meta_phone_number_id;
    if (!phoneId || !secrets.meta_access_token) {
      return { connected: false, error: 'Credenciais Meta ausentes' };
    }
    const res = await fetch(`${this.graphBase}/${phoneId}`, {
      headers: { Authorization: `Bearer ${secrets.meta_access_token}` },
    });
    if (!res.ok) return { connected: false, error: await res.text() };
    const data = await res.json();
    return {
      connected: !!data?.id,
      phoneNumber: data?.display_phone_number,
    };
  }

  async send(secrets: InstanceSecrets, instance: InstanceInfo, msg: SendRequest): Promise<SendResult> {
    const phoneId = instance.meta_phone_number_id;
    if (!phoneId) throw new Error('meta_phone_number_id ausente');
    const headers = {
      Authorization: `Bearer ${secrets.meta_access_token}`,
      'Content-Type': 'application/json',
    };

    let graphBody: Record<string, unknown>;
    const to = msg.to.replace(/\D/g, '');

    if (msg.messageType === 'text') {
      graphBody = { messaging_product: 'whatsapp', to, type: 'text', text: { body: msg.content } };
    } else {
      const mediaType = msg.messageType;
      const mediaObj: Record<string, unknown> = msg.mediaUrl
        ? { link: msg.mediaUrl }
        : {};
      if (msg.content && mediaType !== 'audio') mediaObj.caption = msg.content;
      if (mediaType === 'document' && msg.fileName) mediaObj.filename = msg.fileName;
      graphBody = { messaging_product: 'whatsapp', to, type: mediaType, [mediaType]: mediaObj };
    }

    const res = await fetch(`${this.graphBase}/${phoneId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(graphBody),
    });
    if (!res.ok) throw new Error(`Meta send error: ${await res.text()}`);
    const data = await res.json();
    return { messageId: data?.messages?.[0]?.id || `meta_${Date.now()}`, raw: data };
  }

  async configureWebhook(
    _secrets: InstanceSecrets,
    _instance: InstanceInfo,
    _webhookUrl: string
  ): Promise<{ ok: boolean; action: string }> {
    // Meta configura webhook via Meta Business — não via API
    return { ok: true, action: 'noop_meta_manual' };
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

const _evolution = new EvolutionAdapter();
const _zapi = new ZApiAdapter();
const _meta = new MetaCloudAdapter();

export function getAdapter(providerType: string): ProviderAdapter {
  switch (providerType) {
    case 'zapi':       return _zapi;
    case 'meta_cloud': return _meta;
    case 'self_hosted':
    case 'cloud':
    default:           return _evolution;
  }
}
