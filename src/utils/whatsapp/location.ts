// Localização de mensagem do WhatsApp — leitura no frontend.
//
// A partir de 09/2026 o webhook grava as coordenadas em `metadata.location`
// (ver supabase/functions/_shared/location.ts). Antes disso, o Evolution
// descartava as coordenadas e a Meta escrevia os números dentro do próprio
// texto. As mensagens antigas da Meta ainda são recuperáveis pelo texto; as do
// Evolution não têm como voltar, e continuam sendo só o rótulo.

export interface MessageLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
  live?: boolean;
}

/** Rótulo que o webhook grava em `content` para mensagem de localização. */
const LOCATION_LABEL = /^\s*📍\s*Localiza[çc][ãa]o\s*(?::.*)?$/i;

/** Texto legado da Meta: "📍 Localização: -29.873301,-51.7102077". */
const LEGACY_COORDS = /📍\s*Localiza[çc][ãa]o\s*:\s*(-?\d+(?:[.,]\d+)?)\s*,\s*(-?\d+(?:[.,]\d+)?)/i;

function isValid(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function fromMetadata(metadata: unknown): MessageLocation | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const rawValue = (metadata as Record<string, unknown>).location;
  if (!rawValue || typeof rawValue !== 'object') return null;
  const raw = rawValue as Record<string, unknown>;

  const latitude = Number(raw.latitude);
  const longitude = Number(raw.longitude);
  if (!isValid(latitude, longitude)) return null;

  const loc: MessageLocation = { latitude, longitude };
  if (typeof raw.name === 'string' && raw.name.trim()) loc.name = raw.name.trim();
  if (typeof raw.address === 'string' && raw.address.trim()) loc.address = raw.address.trim();
  if (raw.live === true) loc.live = true;
  return loc;
}

function fromLegacyContent(content: unknown): MessageLocation | null {
  if (typeof content !== 'string') return null;
  const m = content.match(LEGACY_COORDS);
  if (!m) return null;

  const latitude = Number(m[1].replace(',', '.'));
  const longitude = Number(m[2].replace(',', '.'));
  return isValid(latitude, longitude) ? { latitude, longitude } : null;
}

/** Coordenadas da mensagem, do campo estruturado ou do texto legado da Meta. */
export function getMessageLocation(
  msg: { metadata?: unknown; content?: unknown } | null | undefined,
): MessageLocation | null {
  if (!msg) return null;
  return fromMetadata(msg.metadata) ?? fromLegacyContent(msg.content);
}

/**
 * O texto é só o rótulo que o webhook gravou, sem nada escrito pelo cliente.
 * Com o card na tela ele vira eco — mesmo tratamento que o placeholder de mídia.
 */
export function isLocationPlaceholderContent(content: string | null | undefined): boolean {
  return !!content && LOCATION_LABEL.test(content.trim());
}

/** Link universal do Google Maps. Abre no app quando existe, no site quando não. */
export function googleMapsUrl(loc: MessageLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`;
}

/** Coordenada com a precisão que o WhatsApp entrega, sem cauda de zeros. */
export function formatCoords(loc: MessageLocation): string {
  const fmt = (n: number) => String(Number(n.toFixed(6)));
  return `${fmt(loc.latitude)}, ${fmt(loc.longitude)}`;
}
